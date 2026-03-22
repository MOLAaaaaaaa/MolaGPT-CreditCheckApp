//go:build windows

package main

import (
	"fmt"
	"log"
	"os/exec"
	"syscall"
	"unsafe"

	"github.com/jchv/go-webview2"
)

const (
	mbYesNo           = 0x04
	mbIconWarning     = 0x30
	mbIconInformation = 0x40
	idYes             = 6
)

var (
	user32      = syscall.NewLazyDLL("user32.dll")
	messageBoxW = user32.NewProc("MessageBoxW")
)

func showMessageBox(title, msg string, style uintptr) int {
	titlePtr, _ := syscall.UTF16PtrFromString(title)
	msgPtr, _ := syscall.UTF16PtrFromString(msg)
	ret, _, _ := messageBoxW.Call(0, uintptr(unsafe.Pointer(msgPtr)), uintptr(unsafe.Pointer(titlePtr)), style)
	return int(ret)
}

func openInBrowser(url string) {
	exec.Command("cmd", "/c", "start", url).Start()
}

func runApp(url string) {
	log.Printf("创建 WebView2 窗口, URL: %s", url)

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
		ret := showMessageBox(
			"征信核验助手",
			"无法创建应用窗口（缺少 WebView2 Runtime）。\n\n"+
				"是否使用浏览器打开？\n\n"+
				"点击【是】用浏览器打开\n"+
				"点击【否】退出程序\n\n"+
				fmt.Sprintf("服务地址: %s", url),
			mbYesNo|mbIconWarning,
		)
		if ret == idYes {
			log.Println("用户选择浏览器模式")
			openInBrowser(url)
			showMessageBox("征信核验助手",
				fmt.Sprintf("服务正在运行中。\n地址: %s\n\n点击确定关闭服务。", url),
				mbIconInformation,
			)
		} else {
			log.Println("用户选择退出")
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
