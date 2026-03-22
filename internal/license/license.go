package license

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net"
	"os"
	"runtime"
	"strings"
	"sync"

	"credit-check-app/internal/config"
)

const licenseSecret = "CreditCheckApp_License_2024_Secret"

var (
	cachedMachineCode string
	machineCodeOnce   sync.Once
)

// GetMachineCode 生成机器码（结果缓存，只计算一次）
func GetMachineCode() string {
	machineCodeOnce.Do(func() {
		cachedMachineCode = computeMachineCode()
	})
	return cachedMachineCode
}

func computeMachineCode() string {
	parts := []string{}

	// hostname
	if h, err := os.Hostname(); err == nil {
		parts = append(parts, h)
	}

	// OS 标识
	parts = append(parts, runtime.GOOS+"/"+runtime.GOARCH)

	// CPU 数
	parts = append(parts, fmt.Sprintf("cpu%d", runtime.NumCPU()))

	// Windows 特有
	if runtime.GOOS == "windows" {
		if v := os.Getenv("PROCESSOR_IDENTIFIER"); v != "" {
			parts = append(parts, v)
		}
		if v := os.Getenv("COMPUTERNAME"); v != "" {
			parts = append(parts, v)
		}
	}

	// 首个非 loopback MAC 地址
	if mac := getFirstMAC(); mac != "" {
		parts = append(parts, mac)
	}

	raw := strings.Join(parts, "|")

	// HMAC-SHA256 后取前 16 位
	h := hmac.New(sha256.New, []byte(licenseSecret+"_mc"))
	h.Write([]byte(raw))
	hash := hex.EncodeToString(h.Sum(nil))

	code := strings.ToUpper(hash[:16])
	// 格式化: MC-XXXX-XXXX-XXXX-XXXX
	return fmt.Sprintf("MC-%s-%s-%s-%s", code[0:4], code[4:8], code[8:12], code[12:16])
}

// GenerateLicense 根据机器码生成激活码
func GenerateLicense(machineCode string) string {
	h := hmac.New(sha256.New, []byte(licenseSecret))
	h.Write([]byte(machineCode))
	hash := hex.EncodeToString(h.Sum(nil))

	code := strings.ToUpper(hash[:16])
	return fmt.Sprintf("LIC-%s-%s-%s-%s", code[0:4], code[4:8], code[8:12], code[12:16])
}

// ValidateLicense 校验激活码是否匹配机器码
func ValidateLicense(machineCode, licenseKey string) bool {
	expected := GenerateLicense(machineCode)
	return strings.EqualFold(expected, strings.TrimSpace(licenseKey))
}

// IsActivated 检查当前配置是否已激活
func IsActivated(cfg *config.Config) bool {
	if cfg.License.Activated {
		// 重新验证
		mc := GetMachineCode()
		return ValidateLicense(mc, cfg.License.LicenseKey)
	}
	return false
}

// Activate 执行激活
func Activate(cfg *config.Config, licenseKey string) bool {
	mc := GetMachineCode()
	if ValidateLicense(mc, licenseKey) {
		cfg.License.MachineCode = mc
		cfg.License.LicenseKey = licenseKey
		cfg.License.Activated = true
		return true
	}
	return false
}

func getFirstMAC() string {
	interfaces, err := net.Interfaces()
	if err != nil {
		return ""
	}
	for _, iface := range interfaces {
		// 跳过 loopback 和无 MAC 的接口
		if iface.Flags&net.FlagLoopback != 0 || len(iface.HardwareAddr) == 0 {
			continue
		}
		return iface.HardwareAddr.String()
	}
	return ""
}
