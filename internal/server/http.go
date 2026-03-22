package server

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"sync"
	"time"

	"credit-check-app/internal/config"
	"credit-check-app/internal/license"
	"credit-check-app/internal/ollama"
)

var FrontendFS fs.FS
var cfgMu sync.RWMutex

func Start(cfg *config.Config) error {
	mux := http.NewServeMux()

	mux.HandleFunc("/api/config", func(w http.ResponseWriter, r *http.Request) {
		handleConfig(w, r, cfg)
	})
	mux.HandleFunc("/api/license/activate", func(w http.ResponseWriter, r *http.Request) {
		handleActivate(w, r, cfg)
	})
	mux.HandleFunc("/api/license/status", func(w http.ResponseWriter, r *http.Request) {
		cfgMu.RLock()
		activated := license.IsActivated(cfg)
		cfgMu.RUnlock()
		jsonResp(w, map[string]any{
			"activated":    activated,
			"machine_code": license.GetMachineCode(),
		})
	})
	mux.HandleFunc("/api/models", func(w http.ResponseWriter, r *http.Request) {
		handleModels(w, r, cfg)
	})
	mux.HandleFunc("/api/models/available", func(w http.ResponseWriter, r *http.Request) {
		handleAvailableModels(w, r, cfg)
	})
	mux.HandleFunc("/api/chat", func(w http.ResponseWriter, r *http.Request) {
		handleChat(w, r, cfg)
	})

	if FrontendFS != nil {
		mux.Handle("/", http.FileServer(http.FS(FrontendFS)))
	} else {
		mux.Handle("/", http.FileServer(http.Dir("frontend")))
	}

	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
	log.Printf("HTTP 监听: %s", addr)
	return http.ListenAndServe(addr, loggingMiddleware(corsMiddleware(mux)))
}

// ---- Handlers ----

func handleConfig(w http.ResponseWriter, r *http.Request, cfg *config.Config) {
	switch r.Method {
	case http.MethodGet:
		cfgMu.RLock()
		// API Key 脱敏：只显示是否已设置
		apiKeyMasked := ""
		if cfg.Ollama.APIKey != "" {
			k := cfg.Ollama.APIKey
			if len(k) > 8 {
				apiKeyMasked = k[:4] + "****" + k[len(k)-4:]
			} else {
				apiKeyMasked = "****"
			}
		}
		safe := map[string]any{
			"server":  cfg.Server,
			"ollama":  map[string]any{"base_url": cfg.Ollama.BaseURL, "api_key_masked": apiKeyMasked},
			"storage": cfg.Storage,
			"models":  cfg.Models,
		}
		cfgMu.RUnlock()
		jsonResp(w, safe)
	case http.MethodPut:
		var updates config.Config
		if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
			httpError(w, 400, "无效的请求体")
			return
		}
		cfgMu.Lock()
		if updates.Ollama.BaseURL != "" {
			log.Printf("[配置] Ollama 地址更新: %s", updates.Ollama.BaseURL)
			cfg.Ollama.BaseURL = updates.Ollama.BaseURL
		}
		if updates.Ollama.APIKey != "" {
			log.Println("[配置] API Key 已更新")
			cfg.Ollama.APIKey = updates.Ollama.APIKey
		}
		if updates.Storage.Mode != "" {
			log.Printf("[配置] 存储模式更新: %s", updates.Storage.Mode)
			cfg.Storage.Mode = updates.Storage.Mode
		}
		if updates.Server.Port != 0 {
			log.Printf("[配置] 端口更新: %d", updates.Server.Port)
			cfg.Server.Port = updates.Server.Port
		}
		if err := config.Save(cfg); err != nil {
			log.Printf("[配置] 保存失败: %v", err)
		}
		cfgMu.Unlock()
		jsonResp(w, map[string]any{"success": true})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func handleActivate(w http.ResponseWriter, r *http.Request, cfg *config.Config) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		LicenseKey string `json:"license_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpError(w, 400, "无效请求")
		return
	}
	log.Printf("[激活] 收到激活请求, 激活码: %s***", req.LicenseKey[:min(4, len(req.LicenseKey))])
	cfgMu.Lock()
	if license.Activate(cfg, req.LicenseKey) {
		config.Save(cfg)
		cfgMu.Unlock()
		log.Println("[激活] 激活成功")
		jsonResp(w, map[string]any{"success": true, "message": "激活成功"})
	} else {
		cfgMu.Unlock()
		log.Println("[激活] 激活失败: 激活码无效")
		jsonResp(w, map[string]any{"success": false, "message": "激活码无效"})
	}
}

func handleModels(w http.ResponseWriter, r *http.Request, cfg *config.Config) {
	switch r.Method {
	case http.MethodGet:
		cfgMu.RLock()
		jsonResp(w, map[string]any{"models": cfg.Models})
		cfgMu.RUnlock()
	case http.MethodPost:
		var model config.ModelConfig
		if err := json.NewDecoder(r.Body).Decode(&model); err != nil || model.ID == "" {
			httpError(w, 400, "需要 model ID")
			return
		}
		cfgMu.Lock()
		for _, m := range cfg.Models {
			if m.ID == model.ID {
				cfgMu.Unlock()
				httpError(w, 409, "模型已存在")
				return
			}
		}
		cfg.Models = append(cfg.Models, model)
		config.Save(cfg)
		cfgMu.Unlock()
		log.Printf("[模型] 添加模型: %s", model.ID)
		jsonResp(w, map[string]any{"success": true})
	case http.MethodDelete:
		var req struct {
			ID string `json:"id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == "" {
			httpError(w, 400, "需要 model ID")
			return
		}
		cfgMu.Lock()
		filtered := make([]config.ModelConfig, 0)
		for _, m := range cfg.Models {
			if m.ID != req.ID {
				filtered = append(filtered, m)
			}
		}
		cfg.Models = filtered
		config.Save(cfg)
		cfgMu.Unlock()
		log.Printf("[模型] 删除模型: %s", req.ID)
		jsonResp(w, map[string]any{"success": true})
	}
}

func handleAvailableModels(w http.ResponseWriter, r *http.Request, cfg *config.Config) {
	cfgMu.RLock()
	baseURL := cfg.Ollama.BaseURL
	apiKey := cfg.Ollama.APIKey
	cfgMu.RUnlock()
	log.Printf("[模型] 检测可用模型: %s", baseURL)
	client := ollama.NewClient(baseURL, apiKey)
	models, err := client.ListModels()
	if err != nil {
		log.Printf("[模型] 检测失败: %v", err)
		jsonResp(w, map[string]any{"models": []string{}, "error": err.Error()})
		return
	}
	log.Printf("[模型] 检测到 %d 个模型", len(models))
	jsonResp(w, map[string]any{"models": models})
}

func handleChat(w http.ResponseWriter, r *http.Request, cfg *config.Config) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var req ollama.ChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpError(w, 400, "无效请求")
		return
	}

	log.Printf("[聊天] 收到请求: model=%s, messages=%d, stream=%v",
		req.Model, len(req.Messages), req.Stream)
	startTime := time.Now()

	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		httpError(w, 500, "不支持流式输出")
		return
	}

	cfgMu.RLock()
	baseURL := cfg.Ollama.BaseURL
	apiKey := cfg.Ollama.APIKey
	cfgMu.RUnlock()

	client := ollama.NewClient(baseURL, apiKey)
	var totalChunks int
	err := client.ChatStream(req, func(content, reasoning string, done bool) {
		if done {
			fmt.Fprintf(w, "data: [DONE]\n\n")
			flusher.Flush()
			return
		}
		totalChunks++
		delta := map[string]string{}
		if content != "" {
			delta["content"] = content
		}
		if reasoning != "" {
			delta["reasoning_content"] = reasoning
		}
		chunk := map[string]any{
			"choices": []map[string]any{
				{"delta": delta},
			},
		}
		data, _ := json.Marshal(chunk)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	})

	elapsed := time.Since(startTime)
	if err != nil {
		log.Printf("[聊天] 请求失败: model=%s, 耗时=%v, 错误=%v", req.Model, elapsed, err)
		errData, _ := json.Marshal(map[string]any{"error": err.Error()})
		fmt.Fprintf(w, "data: %s\n\n", errData)
		flusher.Flush()
	} else {
		log.Printf("[聊天] 请求完成: model=%s, 耗时=%v, chunks=%d", req.Model, elapsed, totalChunks)
	}
}

// ---- 工具函数 ----

func jsonResp(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(data)
}

func httpError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// loggingMiddleware 记录 API 请求（静态资源不记录）
func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if len(r.URL.Path) >= 4 && r.URL.Path[:4] == "/api" {
			log.Printf("[HTTP] %s %s %s", r.Method, r.URL.Path, r.RemoteAddr)
		}
		next.ServeHTTP(w, r)
	})
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 仅 API 请求设置 CORS 头
		if len(r.URL.Path) >= 4 && r.URL.Path[:4] == "/api" {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			if r.Method == "OPTIONS" {
				w.WriteHeader(204)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
