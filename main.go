package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net"
	"os"
	"time"

	"credit-check-app/internal/config"
	"credit-check-app/internal/license"
	"credit-check-app/internal/server"
)

//go:embed all:frontend
var frontendEmbed embed.FS

func main() {
	// 加载配置
	cfg, err := config.Load()
	if err != nil {
		log.Printf("加载配置失败，使用默认配置: %v", err)
		cfg = config.Default()
	}

	// 检查激活状态
	if !license.IsActivated(cfg) {
		mc := license.GetMachineCode()
		fmt.Printf("征信核验助手 | 机器码: %s | 请在设置中输入激活码\n", mc)
	}

	os.MkdirAll("data", 0755)

	// 将嵌入的 frontend/ 子目录作为静态文件根
	frontendFS, err := fs.Sub(frontendEmbed, "frontend")
	if err != nil {
		log.Fatalf("读取嵌入前端资源失败: %v", err)
	}
	server.FrontendFS = frontendFS

	// 后台启动 HTTP 服务
	go func() {
		if err := server.Start(cfg); err != nil {
			log.Fatalf("服务启动失败: %v", err)
		}
	}()

	// 等待端口就绪
	waitForServer(cfg.Server.Port, 5*time.Second)

	localURL := fmt.Sprintf("http://localhost:%d", cfg.Server.Port)
	fmt.Printf("服务已启动: %s\n", localURL)

	// 平台相关：Windows 打开原生窗口，其他平台保持运行
	runApp(localURL)
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
}
