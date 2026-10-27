; Added to Tauri's installer (bundle.windows.nsis.installerHooks):
; - Netherstone in "Open with" for the files it imports, never as their
;   default app. Tauri's own fileAssociations would make it the default.
; - "Open as Netherstone vault" on folders.
; - The `netherstone` terminal command, by putting the app's bin folder (and
;   nothing else of the app) on the user's PATH.
; Uninstalling takes each of them back out.

!define NETHERSTONE_PROGID "Netherstone.Import"
!define NETHERSTONE_FOLDER_VERB "Netherstone"
!define /ifndef HWND_BROADCAST 0xffff
!define /ifndef WM_SETTINGCHANGE 0x001A

; This file is read before Tauri defines MAINBINARYNAME and PRODUCTNAME, so
; only the macros below, filled in later, use them.

; PATH is read and written by PowerShell's registry calls: they keep %VAR%
; entries as written, and NSIS strings are too short for a long PATH. The bin
; folder reaches PowerShell in NETHERSTONE_BIN, so no folder name can break
; its quoting.
!define NETHERSTONE_USER_PATH `$$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment'); $$entries = @($$key.GetValue('Path', '', 'DoNotExpandEnvironmentNames') -split ';' | Where-Object { $$_ -and $$_ -ne $$env:NETHERSTONE_BIN })`
!define NETHERSTONE_SET_PATH `$$key.SetValue('Path', ($$entries -join ';'), 'ExpandString')`

!macro NETHERSTONE_OPEN_WITH EXT
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${NETHERSTONE_PROGID}" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".${EXT}" ""
!macroend

!macro NETHERSTONE_NO_OPEN_WITH EXT
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${NETHERSTONE_PROGID}"
!macroend

!macro NETHERSTONE_FOLDER_MENU KEY
  WriteRegStr SHCTX "Software\Classes\${KEY}\shell\${NETHERSTONE_FOLDER_VERB}" "" "Open as Netherstone vault"
  WriteRegStr SHCTX "Software\Classes\${KEY}\shell\${NETHERSTONE_FOLDER_VERB}" "Icon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr SHCTX "Software\Classes\${KEY}\shell\${NETHERSTONE_FOLDER_VERB}\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%V$\""
!macroend

!macro NETHERSTONE_PATH COMMAND
  System::Call 'kernel32::SetEnvironmentVariable(t "NETHERSTONE_BIN", t "$INSTDIR\bin")'
  nsExec::Exec `powershell -NoProfile -NonInteractive -Command "${NETHERSTONE_USER_PATH}; ${COMMAND}${NETHERSTONE_SET_PATH}"`
  Pop $0
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=500
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\${NETHERSTONE_PROGID}" "" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\${NETHERSTONE_PROGID}\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr SHCTX "Software\Classes\${NETHERSTONE_PROGID}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  !insertmacro NETHERSTONE_OPEN_WITH "md"
  !insertmacro NETHERSTONE_OPEN_WITH "pdf"
  !insertmacro NETHERSTONE_OPEN_WITH "docx"
  !insertmacro NETHERSTONE_OPEN_WITH "html"

  ; Right-click on a folder, and on the empty space inside one.
  !insertmacro NETHERSTONE_FOLDER_MENU "Directory"
  !insertmacro NETHERSTONE_FOLDER_MENU "Directory\Background"

  !insertmacro NETHERSTONE_PATH "$$entries += $$env:NETHERSTONE_BIN; "

  ; Explorer picks up the new Open with entries now, not after a sign-in.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro NETHERSTONE_NO_OPEN_WITH "md"
  !insertmacro NETHERSTONE_NO_OPEN_WITH "pdf"
  !insertmacro NETHERSTONE_NO_OPEN_WITH "docx"
  !insertmacro NETHERSTONE_NO_OPEN_WITH "html"
  DeleteRegKey SHCTX "Software\Classes\${NETHERSTONE_PROGID}"
  DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  DeleteRegKey SHCTX "Software\Classes\Directory\shell\${NETHERSTONE_FOLDER_VERB}"
  DeleteRegKey SHCTX "Software\Classes\Directory\Background\shell\${NETHERSTONE_FOLDER_VERB}"

  !insertmacro NETHERSTONE_PATH ""

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
