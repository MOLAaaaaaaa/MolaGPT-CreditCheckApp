//go:build windows

package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"

	"github.com/jchv/go-webview2"
)

var (
	user32         = syscall.NewLazyDLL("user32.dll")
	messageBoxW    = user32.NewProc("MessageBoxW")
	shell32        = syscall.NewLazyDLL("shell32.dll")
	shellExecuteW  = shell32.NewProc("ShellExecuteW")
)

// showMessageBox 显示 Windows 原生消息框
func showMessageBox(title, msg string, style uintptr) int {
	titlePtr, _ := syscall.UTF16PtrFromString(title)
	msgPtr, _ := syscall.UTF16PtrFromString(msg)
	ret, _, _ := messageBoxW.Call(0, uintptr(unsafe.Pointer(msgPtr)), uintptr(unsafe.Pointer(titlePtr)), style)
	return int(ret)
}

// openInBrowser 用默认浏览器打开 URL
func openInBrowser(url string) {
	exec.Command("cmd", "/c", "start", url).Start()
}

// initLogFile 初始化日志文件
func initLogFile() *os.File {
	exePath, err := os.Executable()
	if err != nil {
		return nil
	}
	logPath := filepath.Join(filepath.Dir(exePath), "debug.log")
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return nil
	}
	log.SetOutput(f)
	return f
}

func runApp(url string) {
	// GUI 模式下没有控制台，错误写日志文件
	logFile := initLogFile()
	if logFile != nil {
		defer logFile.Close()
	}

	log.Printf("尝试创建 WebView2 窗口，URL: %s", url)

	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		AutoFocus: true,
		WindowOptions: webview2.WindowOptions{
			Title:  "征信核验助手",
			Width:  1280,
			Height: 800,
			Center: true,
		},
	})

	if w == nil {
		log.Println("WebView2 创建失败，回退到浏览器模式")

		// MB_YESNO = 0x04, MB_ICONWARNING = 0x30
		ret := showMessageBox(
			"征信核验助手",
			"无法创建应用窗口（缺少 WebView2 Runtime）。\n\n"+
				"是否使用浏览器打开？\n\n"+
				"点击【是】用浏览器打开\n"+
				"点击【否】退出程序\n\n"+
				fmt.Sprintf("服务地址: %s", url),
			0x04|0x30,
		)
		if ret == 6 { // IDYES = 6
			openInBrowser(url)
			// 保持服务运行
			showMessageBox("征信核验助手",
				fmt.Sprintf("服务正在运行中。\n地址: %s\n\n点击确定关闭服务。", url),
				0x40, // MB_ICONINFORMATION
			)
		}
		return
	}

	log.Println("WebView2 窗口创建成功")
	defer w.Destroy()

	w.SetSize(1280, 800, webview2.HintNone)
	w.Navigate(url)
	w.Run()

	log.Println("窗口已关闭")
}
