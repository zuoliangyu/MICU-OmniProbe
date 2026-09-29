; 从更名前的 EK-OmniProbe 升级到 MICU-OmniProbe：
; 1. 把旧安装目录下的 data（Pack 等）搬到新安装目录，新目录已有 data 时不覆盖
; 2. 静默卸载旧版本，清理旧的开始菜单 / 桌面快捷方式和卸载项；旧卸载器静默模式不会删除用户数据
; 按应用 ID 存放的用户数据（设置、WebView 数据）由应用首次启动时迁移，见 src/legacy_migration.rs

!define LEGACY_PRODUCTNAME "EK-OmniProbe"
!define LEGACY_UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${LEGACY_PRODUCTNAME}"

!macro NSIS_HOOK_POSTINSTALL
  ReadRegStr $R0 HKCU "${LEGACY_UNINSTKEY}" "UninstallString"
  ReadRegStr $R1 HKCU "${LEGACY_UNINSTKEY}" "InstallLocation"

  ; InstallLocation 写入时带引号，去掉首尾引号
  StrCpy $R2 $R1 1
  ${If} $R2 == '"'
    StrCpy $R1 $R1 -1 1
  ${EndIf}

  ${If} $R0 != ""
  ${AndIf} $R1 != ""
  ${AndIf} $R1 != $INSTDIR
    ${If} ${FileExists} "$R1\data\*.*"
    ${AndIfNot} ${FileExists} "$INSTDIR\data\*.*"
      ClearErrors
      Rename "$R1\data" "$INSTDIR\data"
      ${If} ${Errors}
        CopyFiles /SILENT "$R1\data" "$INSTDIR"
      ${EndIf}
    ${EndIf}

    ; _?= 让卸载器在原位同步执行，ExecWait 才能等到卸载完成
    ExecWait '$R0 /S _?=$R1' $R3
    Delete "$R1\uninstall.exe"
    RMDir "$R1"
  ${EndIf}
!macroend
