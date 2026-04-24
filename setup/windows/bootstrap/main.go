package main

import (
	"archive/zip"
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

var version = "__TRANSLATEGEMMA_VERSION__"

const (
	repoOwner   = "siden999"
	repoName    = "TranslateGemma"
	controlURL  = "http://127.0.0.1:18181/status"
	installRoot = "TranslateGemma"
)

func main() {
	code := run()
	waitForEnter()
	os.Exit(code)
}

func run() int {
	if runtime.GOOS != "windows" {
		fmt.Println("這個安裝器只能在 Windows 上執行。")
		return 1
	}

	if strings.HasPrefix(version, "__") || version == "" {
		fmt.Println("安裝器版本未設定，請從 GitHub Release 下載正式的 TranslateGemmaSetup-v*.exe。")
		return 1
	}

	fmt.Printf("TranslateGemma Windows 安裝器 v%s\n", version)
	fmt.Println("這個安裝器會安裝本機 Launcher、Native Host、server 依賴，並驗證控制服務。")

	workRoot := filepath.Join(os.TempDir(), "TranslateGemmaSetup-"+version)
	extractDir := filepath.Join(workRoot, "extract")
	zipPath := filepath.Join(workRoot, fmt.Sprintf("TranslateGemma-win-v%s.zip", version))

	if err := os.RemoveAll(workRoot); err != nil {
		return fail("清理暫存目錄失敗", err)
	}
	if err := os.MkdirAll(extractDir, 0o755); err != nil {
		return fail("建立暫存目錄失敗", err)
	}

	step("準備安裝包")
	localZip := findLocalReleaseZip(version)
	if localZip != "" {
		fmt.Printf("使用本機安裝包：%s\n", localZip)
		if err := copyFile(localZip, zipPath); err != nil {
			return fail("複製本機安裝包失敗", err)
		}
	} else if err := downloadReleaseZip(version, zipPath); err != nil {
		return fail("下載 Windows 安裝包失敗", err)
	}

	step("解壓縮")
	if err := unzip(zipPath, extractDir); err != nil {
		return fail("解壓縮失敗", err)
	}

	installScript := filepath.Join(extractDir, "TranslateGemma-win", "launcher", "install_win.ps1")
	if _, err := os.Stat(installScript); err != nil {
		return fail("安裝包內容不完整，找不到 install_win.ps1", err)
	}

	step("安裝本機 Launcher 與橋接器")
	if err := runPowerShellScript(installScript); err != nil {
		return fail("本機安裝失敗", err)
	}

	step("驗證控制服務")
	if err := waitLauncherReady(45 * time.Second); err != nil {
		printLauncherLogTail(80)
		return fail("Launcher 控制服務未在 127.0.0.1:18181 回應", err)
	}

	extensionDir, err := extensionDir()
	if err != nil {
		return fail("取得 extension 安裝位置失敗", err)
	}
	if _, err := os.Stat(filepath.Join(extensionDir, "manifest.json")); err != nil {
		return fail("Chrome 擴充資料夾不存在", err)
	}

	fmt.Println()
	fmt.Println("安裝完成。")
	fmt.Println("下一步：Chrome 會開啟擴充功能頁。請移除舊版 TranslateGemma，開啟開發者模式，載入這個資料夾：")
	fmt.Println(extensionDir)
	openChromeExtensions()
	return 0
}

func step(message string) {
	fmt.Println()
	fmt.Printf("== %s ==\n", message)
}

func fail(message string, err error) int {
	fmt.Println()
	fmt.Printf("錯誤：%s\n", message)
	if err != nil {
		fmt.Println(err)
	}
	fmt.Println()
	fmt.Println("如果無法排除，請把這個視窗內容和 launcher.log 傳給開發者。")
	return 1
}

func waitForEnter() {
	fmt.Println()
	fmt.Println("按 Enter 關閉視窗...")
	_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
}

func findLocalReleaseZip(version string) string {
	exePath, _ := os.Executable()
	exeDir := filepath.Dir(exePath)
	cwd, _ := os.Getwd()
	name := fmt.Sprintf("TranslateGemma-win-v%s.zip", version)

	candidates := []string{
		filepath.Join(exeDir, name),
		filepath.Join(exeDir, "dist", name),
		filepath.Join(cwd, name),
		filepath.Join(cwd, "dist", name),
	}

	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}

func downloadReleaseZip(version string, destination string) error {
	urls := []string{
		fmt.Sprintf("https://github.com/%s/%s/releases/download/v%s/TranslateGemma-win-v%s.zip", repoOwner, repoName, version, version),
		fmt.Sprintf("https://github.com/%s/%s/raw/refs/tags/v%s/dist/TranslateGemma-win-v%s.zip", repoOwner, repoName, version, version),
	}

	var lastErr error
	for _, url := range urls {
		fmt.Printf("下載：%s\n", url)
		if err := downloadFile(url, destination); err == nil {
			return nil
		} else {
			lastErr = err
			fmt.Printf("下載失敗，改試下一個來源：%v\n", err)
		}
	}
	return lastErr
}

func downloadFile(url string, destination string) error {
	client := &http.Client{Timeout: 30 * time.Minute}
	response, err := client.Get(url)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode > 299 {
		return fmt.Errorf("HTTP %d", response.StatusCode)
	}

	output, err := os.Create(destination)
	if err != nil {
		return err
	}
	defer output.Close()

	_, err = io.Copy(output, response.Body)
	return err
}

func copyFile(source string, destination string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()

	output, err := os.Create(destination)
	if err != nil {
		return err
	}
	defer output.Close()

	_, err = io.Copy(output, input)
	return err
}

func unzip(source string, destination string) error {
	reader, err := zip.OpenReader(source)
	if err != nil {
		return err
	}
	defer reader.Close()

	destinationAbs, err := filepath.Abs(destination)
	if err != nil {
		return err
	}

	for _, file := range reader.File {
		target := filepath.Join(destination, file.Name)
		targetAbs, err := filepath.Abs(target)
		if err != nil {
			return err
		}
		if !strings.HasPrefix(targetAbs, destinationAbs+string(os.PathSeparator)) && targetAbs != destinationAbs {
			return fmt.Errorf("zip entry escapes destination: %s", file.Name)
		}

		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(target, file.Mode()); err != nil {
				return err
			}
			continue
		}

		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}

		sourceFile, err := file.Open()
		if err != nil {
			return err
		}
		targetFile, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, file.Mode())
		if err != nil {
			_ = sourceFile.Close()
			return err
		}
		_, copyErr := io.Copy(targetFile, sourceFile)
		closeErr := errors.Join(sourceFile.Close(), targetFile.Close())
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
	}

	return nil
}

func runPowerShellScript(scriptPath string) error {
	command := exec.Command(
		"powershell.exe",
		"-NoProfile",
		"-ExecutionPolicy",
		"Bypass",
		"-File",
		scriptPath,
	)
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	command.Stdin = os.Stdin
	return command.Run()
}

func waitLauncherReady(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 2 * time.Second}

	for time.Now().Before(deadline) {
		request, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, controlURL, nil)
		response, err := client.Do(request)
		if err == nil {
			_ = response.Body.Close()
			if response.StatusCode == http.StatusOK {
				return nil
			}
		}
		time.Sleep(500 * time.Millisecond)
	}

	return fmt.Errorf("timeout after %s", timeout)
}

func extensionDir() (string, error) {
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		return "", errors.New("LOCALAPPDATA is not set")
	}
	return filepath.Join(localAppData, installRoot, "extension"), nil
}

func launcherLogPath() string {
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		return ""
	}
	return filepath.Join(localAppData, installRoot, "launcher", "launcher.log")
}

func printLauncherLogTail(maxLines int) {
	path := launcherLogPath()
	if path == "" {
		fmt.Println("LOCALAPPDATA 未設定，無法讀取 launcher.log")
		return
	}

	content, err := os.ReadFile(path)
	if err != nil {
		fmt.Printf("無法讀取 launcher.log：%s (%v)\n", path, err)
		return
	}

	lines := strings.Split(strings.ReplaceAll(string(content), "\r\n", "\n"), "\n")
	start := 0
	if len(lines) > maxLines {
		start = len(lines) - maxLines
	}

	fmt.Println()
	fmt.Println("Launcher 最近記錄：")
	for _, line := range lines[start:] {
		fmt.Println(line)
	}
}

func openChromeExtensions() {
	command := exec.Command("cmd", "/c", "start", "", "chrome://extensions/")
	if err := command.Run(); err != nil {
		fmt.Println("請手動開啟 chrome://extensions/")
	}
}
