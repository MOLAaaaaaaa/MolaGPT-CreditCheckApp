package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type Config struct {
	Server   ServerConfig   `json:"server"`
	Ollama   OllamaConfig   `json:"ollama"`
	License  LicenseConfig  `json:"license"`
	Storage  StorageConfig  `json:"storage"`
	Models   []ModelConfig  `json:"models"`
	RiskRule RiskRuleConfig `json:"risk_rule"`
}

type ServerConfig struct {
	Host string `json:"host"`
	Port int    `json:"port"`
}

type OllamaConfig struct {
	BaseURL string `json:"base_url"`
	APIKey  string `json:"api_key"` // 可选
}

type LicenseConfig struct {
	MachineCode string `json:"machine_code"`
	LicenseKey  string `json:"license_key"`
	Activated   bool   `json:"activated"`
}

type StorageConfig struct {
	Mode string `json:"mode"` // "account" | "shared" | "none"
}

type ModelConfig struct {
	ID       string `json:"id"`       // Ollama model ID, e.g. "qwen2.5:7b"
	Thinking bool   `json:"thinking"` // 是否支持思考模式
}

type RiskRuleConfig struct {
	CustomRulesPath string `json:"custom_rules_path"`
}

func Default() *Config {
	return &Config{
		Server: ServerConfig{
			Host: "0.0.0.0",
			Port: 18080,
		},
		Ollama: OllamaConfig{
			BaseURL: "http://localhost:11434",
		},
		Storage: StorageConfig{
			Mode: "shared",
		},
		Models: []ModelConfig{
			{ID: "qwen2.5:7b", Thinking: false},
		},
	}
}

const configFile = "config.json"

func configPath() string {
	exe, err := os.Executable()
	if err != nil {
		return configFile
	}
	return filepath.Join(filepath.Dir(exe), configFile)
}

func Load() (*Config, error) {
	// 优先读取程序目录下的 config.json，其次读当前目录
	paths := []string{configPath(), configFile}
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		cfg := Default()
		if err := json.Unmarshal(data, cfg); err != nil {
			return nil, err
		}
		return cfg, nil
	}
	return nil, os.ErrNotExist
}

func Save(cfg *Config) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(configPath(), data, 0644)
}
