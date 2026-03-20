package ollama

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type Client struct {
	BaseURL string
	APIKey  string
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatRequest struct {
	Model       string    `json:"model"`
	Messages    []Message `json:"messages"`
	Temperature float64   `json:"temperature"`
	Stream      bool      `json:"stream"`
}

type StreamDelta struct {
	Content          string `json:"content,omitempty"`
	ReasoningContent string `json:"reasoning_content,omitempty"`
}

type StreamChoice struct {
	Delta        StreamDelta `json:"delta"`
	FinishReason *string     `json:"finish_reason,omitempty"`
}

type StreamResponse struct {
	Choices []StreamChoice `json:"choices"`
	Error   *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func NewClient(baseURL, apiKey string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		APIKey:  apiKey,
	}
}

// ChatStream 发起流式对话，通过 onChunk 回调逐段返回内容
// onChunk(content, reasoning, done)
func (c *Client) ChatStream(req ChatRequest, onChunk func(string, string, bool)) error {
	req.Stream = true
	body, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("序列化请求失败: %w", err)
	}

	url := c.BaseURL + "/v1/chat/completions"
	httpReq, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("创建请求失败: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if c.APIKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.APIKey)
	}

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("连接失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API 返回 %d: %s", resp.StatusCode, string(errBody))
	}

	scanner := bufio.NewScanner(resp.Body)
	// 增大 buffer 应对大 token 块
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(line[5:])
		if data == "[DONE]" {
			onChunk("", "", true)
			return nil
		}

		var chunk StreamResponse
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		if chunk.Error != nil {
			return fmt.Errorf("API 错误: %s", chunk.Error.Message)
		}
		if len(chunk.Choices) > 0 {
			delta := chunk.Choices[0].Delta
			onChunk(delta.Content, delta.ReasoningContent, chunk.Choices[0].FinishReason != nil)
		}
	}

	return scanner.Err()
}

// ChatSync 非流式对话，返回完整内容
func (c *Client) ChatSync(req ChatRequest) (string, error) {
	req.Stream = false
	body, err := json.Marshal(req)
	if err != nil {
		return "", err
	}

	url := c.BaseURL + "/v1/chat/completions"
	httpReq, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if c.APIKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.APIKey)
	}

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if len(result.Choices) == 0 {
		return "", fmt.Errorf("空响应")
	}
	return result.Choices[0].Message.Content, nil
}

// ListModels 获取 Ollama 已安装的模型列表
func (c *Client) ListModels() ([]string, error) {
	url := c.BaseURL + "/api/tags"
	resp, err := http.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result struct {
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	names := make([]string, len(result.Models))
	for i, m := range result.Models {
		names[i] = m.Name
	}
	return names, nil
}
