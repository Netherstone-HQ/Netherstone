; Added to Tauri's installer (bundle.windows.nsis.installerHooks).
;
; The app adds Netherstone to Open with, the folder menu and the PATH when
; they're turned on in Settings (integrations.rs). The installer adds none of
; them; the uninstaller takes back whatever the app added. Keep the names here
; in step with integrations.rs.

!include LogicLib.nsh

; The header image sits on the right, as nsis-header.bmp is drawn for.
!define MUI_HEADERIMAGE_RIGHT

; The installer grows with the display scale, and NSIS resizes images by
; dropping or repeating pixels. So the images are drawn once per scale
; (scripts/installer-images.mjs), and once the window is up the ones for the
; screen replace the 1x ones Tauri set, before the first page shows.
!define MUI_CUSTOMFUNCTION_GUIINIT Netherstone.GUIInit
!define MUI_CUSTOMFUNCTION_UNGUIINIT un.Netherstone.GUIInit
!define NETHERSTONE_IMAGES "${__FILEDIR__}\.."
; The header's control in Modern UI's dialog.
!define NETHERSTONE_HEADER_IMAGE_ID 1046

!define NETHERSTONE_CLASSES "Software\Classes"
!define NETHERSTONE_PROGID "Netherstone.Import"
!define NETHERSTONE_FOLDER_VERB "Netherstone"
!define NETHERSTONE_ENV_KEY "Environment"
!define /ifndef HWND_BROADCAST 0xffff
!define /ifndef WM_SETTINGCHANGE 0x001A

; Tauri's installer already declares StrLoc; the uninstaller needs its own.
${UnStrRep}

; The display scale in percent: the window's on Windows 10 and later, the
; system's before.
!macro NETHERSTONE_SCALE OUT
  System::Call 'user32::GetDpiForWindow(p $HWNDPARENT) i .r0'
  ${If} $0 == "error"
  ${OrIf} $0 == 0
    System::Call 'user32::GetDC(p 0) p .r1'
    ; LOGPIXELSX
    System::Call 'gdi32::GetDeviceCaps(p r1, i 88) i .r0'
    System::Call 'user32::ReleaseDC(p 0, p r1)'
  ${EndIf}
  ; 96 dpi is 100%.
  IntOp $0 $0 * 100
  IntOp ${OUT} $0 / 96
!macroend

; Puts the images drawn for SCALE where Modern UI loads them from, and shows
; the header again. The largest scale not above the screen's is used.
!macro NETHERSTONE_SCALED_IMAGES SCALE SIDEBAR
  ${If} ${SCALE} >= 150
    !insertmacro NETHERSTONE_USE_IMAGES "-150" ${SIDEBAR}
  ${ElseIf} ${SCALE} >= 125
    !insertmacro NETHERSTONE_USE_IMAGES "-125" ${SIDEBAR}
  ${EndIf}
!macroend

!macro NETHERSTONE_USE_IMAGES SUFFIX SIDEBAR
  !if ${SIDEBAR} == 1
    File "/oname=$PLUGINSDIR\modern-wizard.bmp" "${NETHERSTONE_IMAGES}\nsis-sidebar${SUFFIX}.bmp"
  !endif
  File "/oname=$PLUGINSDIR\modern-header.bmp" "${NETHERSTONE_IMAGES}\nsis-header${SUFFIX}.bmp"
  SetBrandingImage /IMGID=${NETHERSTONE_HEADER_IMAGE_ID} /RESIZETOFIT "$PLUGINSDIR\modern-header.bmp"
!macroend

Function Netherstone.GUIInit
  Push $0
  Push $1
  Push $2
  !insertmacro NETHERSTONE_SCALE $2
  !insertmacro NETHERSTONE_SCALED_IMAGES $2 1
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; The uninstaller has no welcome or finish page, so only the header.
Function un.Netherstone.GUIInit
  Push $0
  Push $1
  Push $2
  !insertmacro NETHERSTONE_SCALE $2
  !insertmacro NETHERSTONE_SCALED_IMAGES $2 0
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

!macro NETHERSTONE_NO_OPEN_WITH EXT
  DeleteRegValue HKCU "${NETHERSTONE_CLASSES}\.${EXT}\OpenWithProgids" "${NETHERSTONE_PROGID}"
!macroend

; NSIS strings hold NSIS_MAX_STRLEN characters, so a PATH that doesn't fit is
; left alone rather than written back cut short.
!macro NETHERSTONE_REMOVE_FROM_PATH
  ReadRegStr $R0 HKCU "${NETHERSTONE_ENV_KEY}" "Path"
  StrLen $R1 ";$R0;"
  ${If} $R1 < ${NSIS_MAX_STRLEN}
    ${UnStrRep} $R2 ";$R0;" ";$INSTDIR\bin;" ";"
    ${If} $R2 != ";$R0;"
      ; Without the semicolons added around it.
      StrCpy $R2 $R2 "" 1
      StrCpy $R2 $R2 -1
      WriteRegExpandStr HKCU "${NETHERSTONE_ENV_KEY}" "Path" $R2
      SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=500
    ${EndIf}
  ${EndIf}
!macroend

; This file is read before Tauri defines MAINBINARYNAME, so only the macro,
; filled in later, uses it.
!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro NETHERSTONE_NO_OPEN_WITH "md"
  !insertmacro NETHERSTONE_NO_OPEN_WITH "txt"
  !insertmacro NETHERSTONE_NO_OPEN_WITH "pdf"
  !insertmacro NETHERSTONE_NO_OPEN_WITH "docx"
  !insertmacro NETHERSTONE_NO_OPEN_WITH "html"
  DeleteRegKey HKCU "${NETHERSTONE_CLASSES}\${NETHERSTONE_PROGID}"
  DeleteRegKey HKCU "${NETHERSTONE_CLASSES}\Applications\${MAINBINARYNAME}.exe"
  DeleteRegKey HKCU "${NETHERSTONE_CLASSES}\Directory\shell\${NETHERSTONE_FOLDER_VERB}"
  DeleteRegKey HKCU "${NETHERSTONE_CLASSES}\Directory\Background\shell\${NETHERSTONE_FOLDER_VERB}"
  !insertmacro NETHERSTONE_REMOVE_FROM_PATH
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
