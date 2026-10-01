; ============================================================================
; 辨妄阁 · 离线安装包（NSIS 3.12 / zlib 压缩）
;
; 这一层只干三件事，安装逻辑一行都不写：
;   1) 提权 + 问落点（$PROGRAMFILES64\Bianwang 起步，可改）；
;   2) 把整个已就绪的包（站点 + 随带运行时 + 图形安装器）解到那里；
;   3) 起 runtime\BianwangRuntime.exe —— 它就是 Electron，带着本包自己的
;      resources\app 四段界面（自检 / 安装 / 自启 / 维护），四段内部再调
;      installer\*.cmd。所以"解包"与"安装"是两步、两个 owner，互不重复。
;
; 压缩器只用 zlib：NSIS 的 COPYING 写明 LZMA 模块是 Common Public License 1.0、
;   bzip2 模块是 bzip2 许可，只有 zlib 模块与 NSIS 本体同为 zlib/libpng 许可；
;   本项目只采纳宽松许可（见 docs\THIRD_PARTY_NOTICES.md）。换 LZMA 须先取得批准。
;
; 编译（scripts\make-offline-package.mjs 会自动调；手工跑时 makensis.exe 必须放在
;   <NSIS 根>\Bin\ 下，否则它会去上一级找 Stubs 并报 "reading stub ..."）：
;   Bin\makensis.exe -V2 -DVERSION=1.1.0 -DSTAGE=<stage 绝对路径> -DLICENSE=<LICENSE 绝对路径> offline.nsi
; ============================================================================
Unicode True
!include "MUI2.nsh"
!include "WinVer.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!ifndef STAGE
  !error "必须给 -DSTAGE=<已就绪包的绝对路径>"
!endif
!ifndef LICENSE
  !define LICENSE "..\..\LICENSE"
!endif

Name "辨妄阁 ${VERSION}"
OutFile "bianwang-${VERSION}-offline-win.exe"
InstallDir "$PROGRAMFILES64\Bianwang"
InstallDirRegKey HKLM "Software\Bianwang" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID zlib
XPStyle on
ShowInstDetails show
ShowUninstDetails show
!define MUI_ABORTWARNING

; ---------------------------------------------------------------- 版本判定 --
; Windows 10 与 Windows Server 2019 是这轮交付的目标环境；Server 2019 的内部版本号
; 就是 10.0，所以 ${AtLeastWin10} 一条覆盖两者。低于它的机器上，包内随带的
; Electron 44 本来就不在官方支持面里——早说清楚，比让它起不来好。
; Server Core 没有图形子系统，Electron 起不来，所以那条路指向纯批处理的
; setup.cmd /cli（它不依赖任何 exe）。
Function .onInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "辨妄阁离线安装包要求 Windows 10 或 Windows Server 2019 及以上。$\n$\n这台机器低于该要求：包内随带的 Electron 44 运行时不支持它。"
    Abort
  ${EndIf}
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "包内运行时是 x64 的，这台机器是 32 位 Windows，装不上。"
    Abort
  ${EndIf}
FunctionEnd

; ------------------------------------------------------------------- 页面 --
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${LICENSE}"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\runtime\BianwangRuntime.exe"
!define MUI_FINISHPAGE_RUN_TEXT "打开辨妄阁安装器（自检 / 安装 / 自启 / 维护）"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\docs\DEPLOY.md"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "先看部署文档"
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
!insertmacro MUI_PAGE_FINISH

; 卸载确认页上把话说在前面：这条路径会连 api\data 一起删。想留档的人应该走
; installer\uninstall.cmd（交互，会先给 api\data 做一份副本再要 DELETE 这个词）。
!define MUI_UNCONFIRMPAGE_TEXT_TOP "警告：这里会删掉整个程序目录，包括 api\data 里的档案、上传的图片、镜像文件与明文口令表。$\n$\n想先留一份数据副本，请改用 installer\uninstall.cmd（它会先把 api\data 拷到你指定的地方，再要一个 DELETE 确认）。"
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

; ----------------------------------------------------------------- 安装段 --
Section "辨妄阁 ${VERSION}" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"

  ; 整包解出：api / web / nginx / ops / docs / dashboard / installer / runtime
  File /r "${STAGE}\*.*"

  WriteRegStr HKLM "Software\Bianwang" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\Bianwang" "Version" "${VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Bianwang" "DisplayName" "辨妄阁"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Bianwang" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Bianwang" "Publisher" "辨妄阁"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Bianwang" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Bianwang" "DisplayIcon" "$INSTDIR\runtime\BianwangRuntime.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Bianwang" "UninstallString" '"$INSTDIR\installer\uninstall-offline.exe"'
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Bianwang" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Bianwang" "NoRepair" 1
  ; 380000 KB ≈ 解包后的 370 MB（Electron 运行时占大头），控制面板排序要用
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Bianwang" "EstimatedSize" 380000
  WriteUninstaller "$INSTDIR\installer\uninstall-offline.exe"
SectionEnd

; ----------------------------------------------------------------- 卸载段 --
Section "Uninstall"
  ; 卸载器自己就在要删的目录里：先把自己搬到 %TEMP% 再跑那一份，否则 RMDir 撞上
  ; 正在运行的 exe，最后会留一个删不掉的 uninstall-offline.exe。
  ; _?=$INSTDIR 是告诉第二份"别再去 %TEMP% 落脚，直接按这个安装目录干活"。
  ${If} $EXEPATH != "$TEMP\bw-uninstall-offline.exe"
    CopyFiles /SILENT "$EXEPATH" "$TEMP\bw-uninstall-offline.exe"
    Exec '"$TEMP\bw-uninstall-offline.exe" /S _?=$INSTDIR'
    Quit
  ${EndIf}

  ; 先让引擎停站点、撤计划任务与 Run 键——这些不归 NSIS 懂。< nul 是必需的：
  ; uninstall.cmd 的分支里有 pause，stdin 不接空就会把卸载器吊在那里。
  nsExec::ExecToLog 'cmd.exe /c ""$INSTDIR\installer\uninstall.cmd" /quiet < nul"'
  Pop $0

  Delete "$SMPROGRAMS\辨妄阁.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Bianwang"
  DeleteRegKey HKLM "Software\Bianwang"
SectionEnd
