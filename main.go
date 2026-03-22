package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net"
	"os"
	"path/filepath"
	"time"

	"credit-check-app/internal/config"
	"credit-check-app/internal/license"
	"credit-check-app/internal/server"
)

//go:embed all:frontend
var frontendEmbed embed.FS

// exeDir 返回可执行文件所在目录
func exeDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	return filepath.Dir(exe)
}

// initLogger 初始化日志到 exe 目录下的 debug.log
func initLogger() *os.File {
	logPath := filepath.Join(exeDir(), "debug.log")
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		// 回退到 stderr
		log.SetFlags(log.Ldate | log.Ltime)
		log.Printf("无法创建日志文件 %s: %v", logPath, err)
		return nil
	}
	log.SetOutput(f)
	log.SetFlags(log.Ldate | log.Ltime)
	return f
}

func main() {
	// 初始化日志（所有平台，Windows GUI 模式下尤其重要）
	logFile := initLogger()
	if logFile != nil {
		defer logFile.Close()
	}

	log.Println("========== 征信核验助手启动 ==========")
	log.Printf("工作目录: %s", exeDir())

	// 加载配置
	cfg, err := config.Load()
	if err != nil {
		log.Printf("加载配置失败，使用默认配置: %v", err)
		cfg = config.Default()
	} else {
		log.Printf("配置加载成功: 端口=%d, Ollama=%s, 模型数=%d",
			cfg.Server.Port, cfg.Ollama.BaseURL, len(cfg.Models))
	}

	// 检查激活状态
	mc := license.GetMachineCode()
	activated := license.IsActivated(cfg)
	log.Printf("机器码: %s, 激活状态: %v", mc, activated)
	if !activated {
		fmt.Printf("征信核验助手 | 机器码: %s | 请在设置中输入激活码\n", mc)
	}

	// 确保数据目录在 exe 目录下
	dataDir := filepath.Join(exeDir(), "data")
	os.MkdirAll(dataDir, 0755)
	log.Printf("数据目录: %s", dataDir)

	// 将嵌入的 frontend/ 子目录作为静态文件根
	frontendFS, err := fs.Sub(frontendEmbed, "frontend")
	if err != nil {
		log.Fatalf("读取嵌入前端资源失败: %v", err)
	}
	server.FrontendFS = frontendFS

	// 后台启动 HTTP 服务
	go func() {
		log.Printf("HTTP 服务启动中: %s:%d", cfg.Server.Host, cfg.Server.Port)
		if err := server.Start(cfg); err != nil {
			log.Fatalf("服务启动失败: %v", err)
		}
	}()

	// 等待端口就绪
	waitForServer(cfg.Server.Port, 5*time.Second)

	localURL := fmt.Sprintf("http://localhost:%d", cfg.Server.Port)
	log.Printf("HTTP 服务就绪: %s", localURL)
	fmt.Printf("服务已启动: %s\n", localURL)

	// 平台相关：Windows 打开原生窗口，其他平台保持运行
	runApp(localURL)

	log.Println("========== 征信核验助手退出 ==========")
}

func waitForServer(port int, timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	addr := fmt.Sprintf("localhost:%d", port)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", addr, 200*time.Millisecond)
		if err == nil {
			conn.Close()
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	log.Printf("警告: 等待端口 %d 超时", port)
}
