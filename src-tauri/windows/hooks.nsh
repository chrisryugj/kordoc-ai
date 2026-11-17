; KorDoc AI NSIS installer hooks (tauri.conf.json > bundle.windows.nsis.installerHooks).
; Keep this file ASCII only: NSIS reads an !include file without a BOM in the build machine's ANSI code page.
;
; The app adds its Explorer right-click menu itself (Settings, or "kordoc-ai.exe --shell-menu install"):
; one key per extension, HKCU\Software\Classes\SystemFileAssociations\<ext>\shell\KorDoc, plus the folder menu
; HKCU\Software\Classes\Directory\shell\KorDoc and Directory\Background\shell\KorDoc (src-tauri/src/shell.rs,
; a unit test there checks this list against EXTS and FOLDER_KEYS). A real uninstall removes exactly those keys so no dead menu
; stays behind. They are kept when the uninstaller only clears the way for a newer version into the same folder:
;   $UpdateMode = 1     run with /UPDATE (updater)
;   $EXEDIR = $INSTDIR  run in place with _?= by a newer installer ("uninstall before installing", the default
;                       choice for a manual upgrade); a normal uninstall first copies itself to %TEMP%.

; Another AI app (Claude Desktop, Cursor, Codex ...) that the user connected over MCP keeps running the bundled
; node.exe from this folder ("<INSTDIR>\node\node.exe ... --mcp"). Tauri only checks kordoc-ai.exe, so an upgrade
; or uninstall met a locked node.exe ("Error opening file for writing", or old and new files mixed).
; Stop only node.exe processes whose path is under $INSTDIR (other Node programs are left alone). The folder goes to
; PowerShell through an environment variable, not inside the command, so any folder name is safe. Script (UTF-16LE, base64):
;   $d=$env:KD_DIR;if(!$d){exit};$d=$d.TrimEnd('\')+'\';Get-CimInstance Win32_Process -Filter "Name='node.exe'"|?{"$($_.ExecutablePath)".StartsWith($d,5)}|%{Stop-Process -Id $_.ProcessId -Force}
!macro KORDOC_STOP_ENGINES
  Push $0 ; keep the installer's $0 (nsExec leaves its exit code on the stack)
  System::Call 'Kernel32::SetEnvironmentVariable(t "KD_DIR", t "$INSTDIR")i'
  nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -EncodedCommand JABkAD0AJABlAG4AdgA6AEsARABfAEQASQBSADsAaQBmACgAIQAkAGQAKQB7AGUAeABpAHQAfQA7ACQAZAA9ACQAZAAuAFQAcgBpAG0ARQBuAGQAKAAnAFwAJwApACsAJwBcACcAOwBHAGUAdAAtAEMAaQBtAEkAbgBzAHQAYQBuAGMAZQAgAFcAaQBuADMAMgBfAFAAcgBvAGMAZQBzAHMAIAAtAEYAaQBsAHQAZQByACAAIgBOAGEAbQBlAD0AJwBuAG8AZABlAC4AZQB4AGUAJwAiAHwAPwB7ACIAJAAoACQAXwAuAEUAeABlAGMAdQB0AGEAYgBsAGUAUABhAHQAaAApACIALgBTAHQAYQByAHQAcwBXAGkAdABoACgAJABkACwANQApAH0AfAAlAHsAUwB0AG8AcAAtAFAAcgBvAGMAZQBzAHMAIAAtAEkAZAAgACQAXwAuAFAAcgBvAGMAZQBzAHMASQBkACAALQBGAG8AcgBjAGUAfQA='
  Pop $0
  Pop $0
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro KORDOC_STOP_ENGINES
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro KORDOC_STOP_ENGINES
  ${If} $UpdateMode <> 1
  ${AndIf} $EXEDIR != $INSTDIR
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.hwp\shell\KorDoc"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.hwpx\shell\KorDoc"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.hml\shell\KorDoc"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.hwpml\shell\KorDoc"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\KorDoc"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.docx\shell\KorDoc"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.xls\shell\KorDoc"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.xlsx\shell\KorDoc"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pptx\shell\KorDoc"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.png\shell\KorDoc"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.jpg\shell\KorDoc"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.jpeg\shell\KorDoc"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.webp\shell\KorDoc"
    DeleteRegKey HKCU "Software\Classes\Directory\shell\KorDoc"
    DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\KorDoc"
  ${EndIf}
!macroend
