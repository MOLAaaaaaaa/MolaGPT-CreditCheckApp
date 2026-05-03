package config

// AppProfile 定义应用身份和功能开关
// 做 MolaGPT 独立版时，只需要改这个结构体的默认值
type AppProfile struct {
	// 品牌
	AppName      string `json:"app_name"`       // 窗口标题 & 页面标题
	AppSubtitle  string `json:"app_subtitle"`   // 欢迎页副标题
	LogoFile     string `json:"logo_file"`      // logo 文件名（frontend/img/ 下）
	FooterText   string `json:"footer_text"`    // 底栏文字
	Version      string `json:"version"`        // 版本号

	// 功能开关
	EnablePDFUpload    bool `json:"enable_pdf_upload"`     // PDF 上传解析
	EnableRiskScan     bool `json:"enable_risk_scan"`      // 风险项扫描
	EnableDualCompare  bool `json:"enable_dual_compare"`   // 双 AI 对比
	EnableFileUpload   bool `json:"enable_file_upload"`    // 通用文件上传
	EnableChatHistory  bool `json:"enable_chat_history"`   // 对话历史
	EnableSystemPrompt bool `json:"enable_system_prompt"`  // 自定义系统提示词
	EnableLicense      bool `json:"enable_license"`        // 许可证激活
	LandingMode        string `json:"landing_mode"`        // 首页模式: "chat"(聊天) / "upload"(上传)

	// 默认提示词
	DefaultSystemPrompt string `json:"default_system_prompt"`
}

// CreditCheckProfile 征信核验助手的配置
func CreditCheckProfile() AppProfile {
	return AppProfile{
		AppName:      "征信核验助手",
		AppSubtitle:  "上传征信报告，AI 帮您分析瑕疵",
		LogoFile:     "pwaIcon1.png",
		FooterText:   "征信核验助手",
		Version:      "1.0.0",

		EnablePDFUpload:    true,
		EnableRiskScan:     true,
		EnableDualCompare:  true,
		EnableFileUpload:   true,
		EnableChatHistory:  true,
		EnableSystemPrompt: true,
		EnableLicense:      true,
		LandingMode:        "upload",

		DefaultSystemPrompt: "你是一位专业的征信分析师，擅长解读中国人民银行个人/企业征信报告。用户会提供征信报告内容，请你：\n1. 逐项分析是否存在瑕疵\n2. 标注风险等级（高/中/低）\n3. 给出具体的改善建议\n请用结构化格式输出分析结果。",
	}
}

// MolaGPTProfile MolaGPT 独立版的配置（未来使用）
func MolaGPTProfile() AppProfile {
	return AppProfile{
		AppName:      "MolaGPT",
		AppSubtitle:  "时刻准备着。",
		LogoFile:     "pwaIcon1.png",
		FooterText:   "MolaGPT 独立版",
		Version:      "1.0.0",

		EnablePDFUpload:    false,
		EnableRiskScan:     false,
		EnableDualCompare:  false,
		EnableFileUpload:   true,
		EnableChatHistory:  true,
		EnableSystemPrompt: true,
		EnableLicense:      true,
		LandingMode:        "chat",

		DefaultSystemPrompt: "",
	}
}
