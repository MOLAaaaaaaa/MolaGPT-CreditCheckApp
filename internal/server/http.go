package server

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"

	"credit-check-app/internal/config"
	"credit-check-app/internal/license"
	"credit-check-app/internal/ollama"
)

// FrontendFS 由 main.go 注入的嵌入式前端文件系统
var FrontendFS fs.FS

func Start(cfg *config.Config) error {
	mux := http.NewServeMux()

	// ---- API 路由 ----

	// 配置相关
	mux.HandleFunc("/api/config", func(w http.ResponseWriter, r *http.Request) {
		handleConfig(w, r, cfg)
	})

	// 激活
	mux.HandleFunc("/api/license/activate", func(w http.ResponseWriter, r *http.Request) {
		handleActivate(w, r, cfg)
	})
	mux.HandleFunc("/api/license/status", func(w http.ResponseWriter, r *http.Request) {
		jsonResp(w, map[string]any{
			"activated":    license.IsActivated(cfg),
			"machine_code": license.GetMachineCode(),
		})
	})

	// 模型管理
	mux.HandleFunc("/api/models", func(w http.ResponseWriter, r *http.Request) {
		handleModels(w, r, cfg)
	})
	mux.HandleFunc("/api/models/available", func(w http.ResponseWriter, r *http.Request) {
		handleAvailableModels(w, r, cfg)
	})

	// 聊天（SSE 流式）
	mux.HandleFunc("/api/chat", func(w http.ResponseWriter, r *http.Request) {
		handleChat(w, r, cfg)
	})

	// ---- 静态文件（从嵌入的前端 FS 读取） ----
	if FrontendFS != nil {
		mux.Handle("/", http.FileServer(http.FS(FrontendFS)))
	} else {
		mux.Handle("/", http.FileServer(http.Dir("frontend")))
	}

	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
	return http.ListenAndServe(addr, corsMiddleware(mux))
}

// ---- Handlers ----

func handleConfig(w http.ResponseWriter, r *http.Request, cfg *config.Config) {
	switch r.Method {
	case http.MethodGet:
		// 返回配置（隐藏敏感字段）
		safe := map[string]any{
			"server":  cfg.Server,
			"ollama":  map[string]any{"base_url": cfg.Ollama.BaseURL},
			"storage": cfg.Storage,
			"models":  cfg.Models,
		}
		jsonResp(w, safe)
	case http.MethodPut:
		var updates config.Config
		if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
			httpError(w, 400, "无效的请求体")
			return
		}
		// 更新允许修改的字段
		if updates.Ollama.BaseURL != "" {
			cfg.Ollama.BaseURL = updates.Ollama.BaseURL
		}
		if updates.Ollama.APIKey != "" {
			cfg.Ollama.APIKey = updates.Ollama.APIKey
		}
		if updates.Storage.Mode != "" {
			cfg.Storage.Mode = updates.Storage.Mode
		}
		if updates.Server.Port != 0 {
			cfg.Server.Port = updates.Server.Port
		}
		config.Save(cfg)
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
	if license.Activate(cfg, req.LicenseKey) {
		config.Save(cfg)
		jsonResp(w, map[string]any{"success": true, "message": "激活成功"})
	} else {
		jsonResp(w, map[string]any{"success": false, "message": "激活码无效"})
	}
}

func handleModels(w http.ResponseWriter, r *http.Request, cfg *config.Config) {
	switch r.Method {
	case http.MethodGet:
		jsonResp(w, map[string]any{"models": cfg.Models})
	case http.MethodPost:
		var model config.ModelConfig
		if err := json.NewDecoder(r.Body).Decode(&model); err != nil || model.ID == "" {
			httpError(w, 400, "需要 model ID")
			return
		}
		// 去重
		for _, m := range cfg.Models {
			if m.ID == model.ID {
				httpError(w, 409, "模型已存在")
				return
			}
		}
		cfg.Models = append(cfg.Models, model)
		config.Save(cfg)
		jsonResp(w, map[string]any{"success": true})
	case http.MethodDelete:
		var req struct {
			ID string `json:"id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == "" {
			httpError(w, 400, "需要 model ID")
			return
		}
		filtered := make([]config.ModelConfig, 0)
		for _, m := range cfg.Models {
			if m.ID != req.ID {
				filtered = append(filtered, m)
			}
		}
		cfg.Models = filtered
		config.Save(cfg)
		jsonResp(w, map[string]any{"success": true})
	}
}

func handleAvailableModels(w http.ResponseWriter, r *http.Request, cfg *config.Config) {
	client := ollama.NewClient(cfg.Ollama.BaseURL, cfg.Ollama.APIKey)
	models, err := client.ListModels()
	if err != nil {
		jsonResp(w, map[string]any{"models": []string{}, "error": err.Error()})
		return
	}
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

	// SSE headers
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		httpError(w, 500, "不支持流式输出")
		return
	}

	client := ollama.NewClient(cfg.Ollama.BaseURL, cfg.Ollama.APIKey)
	err := client.ChatStream(req, func(content, reasoning string, done bool) {
		if done {
			fmt.Fprintf(w, "data: [DONE]\n\n")
			flusher.Flush()
			return
		}
		// 构造 OpenAI 兼容的 SSE 格式
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

	if err != nil {
		errData, _ := json.Marshal(map[string]any{"error": err.Error()})
		fmt.Fprintf(w, "data: %s\n\n", errData)
		flusher.Flush()
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

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		if r.Method == "OPTIONS" {
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}
