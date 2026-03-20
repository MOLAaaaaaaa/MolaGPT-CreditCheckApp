package main

import (
	"credit-check-app/internal/config"
	"credit-check-app/internal/license"
	"credit-check-app/internal/server"
	"fmt"
	"log"
	"os"
)

func main() {
	// 加载配置
	cfg, err := config.Load()
	if err != nil {
		log.Printf("加载配置失败，使用默认配置: %v", err)
		cfg = config.Default()
	}

	// 检查激活状态
	activated := license.IsActivated(cfg)
	if !activated {
		machineCode := license.GetMachineCode()
		fmt.Println("========================================")
		fmt.Println("  征信核验助手 - 首次启动")
		fmt.Printf("  机器码: %s\n", machineCode)
		fmt.Println("  请在安装向导中输入激活码")
		fmt.Println("========================================")
	}

	// 确保数据目录存在
	os.MkdirAll("data", 0755)

	// 启动 HTTP 服务（同时服务前端和 API）
	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
	fmt.Printf("服务启动于 http://%s\n", addr)
	if err := server.Start(cfg); err != nil {
		log.Fatalf("服务启动失败: %v", err)
	}
}
