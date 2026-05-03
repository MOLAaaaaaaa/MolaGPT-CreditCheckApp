package pdf

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"strings"

	ledongpdf "github.com/ledongthuc/pdf"
)

// ExtractText 从 PDF 二进制数据中提取纯文本
func ExtractText(data []byte) (string, error) {
	reader := bytes.NewReader(data)
	pdfReader, err := ledongpdf.NewReader(reader, int64(len(data)))
	if err != nil {
		return "", fmt.Errorf("无法解析 PDF: %w", err)
	}

	totalPages := pdfReader.NumPage()
	if totalPages == 0 {
		return "", fmt.Errorf("PDF 无页面内容")
	}
	log.Printf("[PDF] 解析中: %d 页", totalPages)

	var sb strings.Builder
	for i := 1; i <= totalPages; i++ {
		page := pdfReader.Page(i)
		if page.V.IsNull() {
			continue
		}
		text, err := extractPageText(page)
		if err != nil {
			log.Printf("[PDF] 第 %d 页提取失败: %v", i, err)
			continue
		}
		if text != "" {
			sb.WriteString(fmt.Sprintf("--- 第 %d 页 ---\n", i))
			sb.WriteString(text)
			sb.WriteString("\n\n")
		}
	}

	result := strings.TrimSpace(sb.String())
	if result == "" {
		return "", fmt.Errorf("PDF 中未提取到文字内容（可能是扫描件）")
	}
	log.Printf("[PDF] 提取完成: %d 页, %d 字符", totalPages, len(result))
	return result, nil
}

// ExtractTextFromReader 从 io.Reader 中读取并提取文本
func ExtractTextFromReader(r io.Reader) (string, error) {
	data, err := io.ReadAll(r)
	if err != nil {
		return "", fmt.Errorf("读取文件失败: %w", err)
	}
	return ExtractText(data)
}

// extractPageText 提取单页文本
func extractPageText(page ledongpdf.Page) (string, error) {
	rows, err := page.GetTextByRow()
	if err != nil {
		return "", err
	}
	var sb strings.Builder
	for _, row := range rows {
		for i, word := range row.Content {
			if i > 0 {
				sb.WriteString(" ")
			}
			sb.WriteString(word.S)
		}
		sb.WriteString("\n")
	}
	return sb.String(), nil
}
