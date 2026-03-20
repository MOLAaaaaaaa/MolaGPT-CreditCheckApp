package risk

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"
)

// Rule 单条风险规则
type Rule struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`        // 规则名称
	Category    string   `json:"category"`     // 分类：逾期、负债、查询、担保、异常
	Keywords    []string `json:"keywords"`     // 关键词匹配
	Pattern     string   `json:"pattern"`      // 正则匹配（可选）
	Severity    string   `json:"severity"`     // high / medium / low
	Description string   `json:"description"`  // 说明
	Builtin     bool     `json:"builtin"`      // 是否内置
}

// MatchResult 匹配结果
type MatchResult struct {
	Rule     Rule   `json:"rule"`
	Matched  string `json:"matched"`  // 匹配到的文本
	Position int    `json:"position"` // 在原文中的位置
}

// Engine 风险匹配引擎
type Engine struct {
	Rules []Rule
}

// NewEngine 创建引擎，加载内置规则 + 自定义规则
func NewEngine(customRulesPath string) *Engine {
	e := &Engine{
		Rules: builtinRules(),
	}
	if customRulesPath != "" {
		if custom, err := loadRulesFromFile(customRulesPath); err == nil {
			e.Rules = append(e.Rules, custom...)
		}
	}
	return e
}

// Match 对文本执行风险匹配
func (e *Engine) Match(text string) []MatchResult {
	var results []MatchResult
	textLower := strings.ToLower(text)

	for _, rule := range e.Rules {
		// 关键词匹配
		for _, kw := range rule.Keywords {
			kwLower := strings.ToLower(kw)
			idx := strings.Index(textLower, kwLower)
			if idx >= 0 {
				// 提取上下文
				start := max(0, idx-20)
				end := min(len(text), idx+len(kw)+20)
				results = append(results, MatchResult{
					Rule:     rule,
					Matched:  text[start:end],
					Position: idx,
				})
				break // 一条规则只报一次
			}
		}
		// 正则匹配
		if rule.Pattern != "" {
			re, err := regexp.Compile(rule.Pattern)
			if err != nil {
				continue
			}
			loc := re.FindStringIndex(text)
			if loc != nil {
				start := max(0, loc[0]-20)
				end := min(len(text), loc[1]+20)
				results = append(results, MatchResult{
					Rule:     rule,
					Matched:  text[start:end],
					Position: loc[0],
				})
			}
		}
	}
	return results
}

func builtinRules() []Rule {
	return []Rule{
		{ID: "R001", Name: "当前逾期", Category: "逾期", Keywords: []string{"当前逾期", "当前逾期金额", "当前逾期期数"}, Severity: "high", Description: "存在当前未还逾期", Builtin: true},
		{ID: "R002", Name: "历史逾期", Category: "逾期", Keywords: []string{"累计逾期次数", "最长逾期月数", "逾期月份"}, Severity: "medium", Description: "存在历史逾期记录", Builtin: true},
		{ID: "R003", Name: "连续逾期", Category: "逾期", Keywords: []string{"连续逾期", "连三累六"}, Pattern: `连续\d+期逾期`, Severity: "high", Description: "连续多期逾期", Builtin: true},
		{ID: "R004", Name: "呆账", Category: "异常", Keywords: []string{"呆账"}, Severity: "high", Description: "存在呆账记录", Builtin: true},
		{ID: "R005", Name: "代偿", Category: "担保", Keywords: []string{"代偿", "担保代偿", "保证人代偿"}, Severity: "high", Description: "存在担保代偿记录", Builtin: true},
		{ID: "R006", Name: "对外担保", Category: "担保", Keywords: []string{"对外担保", "担保余额", "保证责任"}, Severity: "medium", Description: "存在对外担保", Builtin: true},
		{ID: "R007", Name: "查询频繁", Category: "查询", Keywords: []string{"贷款审批", "信用卡审批", "保前审查"}, Pattern: `近\d+个?月.*查询.*\d+次`, Severity: "medium", Description: "近期查询次数过多", Builtin: true},
		{ID: "R008", Name: "高负债率", Category: "负债", Keywords: []string{"负债率", "使用率", "授信使用"}, Pattern: `(负债率|使用率|利用率).{0,10}\d{2,3}%`, Severity: "medium", Description: "负债率/使用率偏高", Builtin: true},
		{ID: "R009", Name: "小贷记录", Category: "异常", Keywords: []string{"小额贷款", "消费金融", "网络小贷"}, Severity: "low", Description: "存在小贷/消金记录", Builtin: true},
		{ID: "R010", Name: "特殊交易", Category: "异常", Keywords: []string{"强制执行", "以资抵债", "司法追偿"}, Severity: "high", Description: "存在特殊交易记录", Builtin: true},
		{ID: "R011", Name: "欠税", Category: "异常", Keywords: []string{"欠税", "税务处罚"}, Severity: "high", Description: "存在欠税记录", Builtin: true},
		{ID: "R012", Name: "行政处罚", Category: "异常", Keywords: []string{"行政处罚", "民事判决", "强制执行"}, Severity: "high", Description: "存在行政处罚或法院记录", Builtin: true},
	}
}

func loadRulesFromFile(path string) ([]Rule, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var rules []Rule
	if err := json.Unmarshal(data, &rules); err != nil {
		return nil, err
	}
	return rules, nil
}
