//go:build !windows

package main

import "fmt"

func runApp(url string) {
	fmt.Printf("非 Windows 环境，请在浏览器中访问: %s\n", url)
	select {}
}
