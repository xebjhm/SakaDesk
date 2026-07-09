; Inno Setup Script for SakaDesk
; Creates a Windows installer package

#define MyAppName "SakaDesk"
; Version can be overridden via command line: iscc /DAppVersion=1.2.3 setup.iss
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
#define MyAppVersion AppVersion
#define MyAppPublisher "xebjhm"
#define MyAppURL "https://github.com/xebjhm/SakaDesk"
#define MyAppExeName "SakaDesk.exe"

[Setup]
; NOTE: The value of AppId uniquely identifies this application.
AppId={{1314045D-48FF-4534-A2A7-4672E8EC1829}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DisableProgramGroupPage=yes
; XREPO-03: do NOT let the user pick an arbitrary existing directory. The
; uninstaller force-removes app-owned subtrees under {app} (see
; [UninstallDelete] / [Code]); if {app} were e.g. C:\Tools or a Documents
; subfolder, that cleanup could touch unrelated pre-existing files. Pinning the
; install dir to {autopf}\SakaDesk keeps {app} app-dedicated.
DisableDirPage=yes
; Run without admin rights (install for current user only)
PrivilegesRequired=lowest
OutputDir=..\..\dist
OutputBaseFilename=SakaDesk-{#MyAppVersion}-Setup
SetupIconFile=SakaDesk.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
; Show language selection dialog at install
ShowLanguageDialog=yes
; Close running SakaDesk before install/uninstall
CloseApplications=yes
CloseApplicationsFilter=*.exe
; The app holds this mutex (desktop.py) for its whole lifetime. Setup detects it
; and, together with PrepareToInstall below, waits for the app to fully exit
; before replacing files — the app's loaded DLLs in _internal (e.g. libffi-8.dll)
; stay locked until the process truly terminates.
; NAME-SYNC: keep identical to INSTANCE_MUTEX_NAME in desktop.py. build.ps1 runs
; tooling/windows/check_mutex_sync.py as a preflight and fails the build on drift.
AppMutex=SakaDeskInstanceMutex

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"
; Chinese ISL files are unofficial translations bundled locally
; Source: https://github.com/jrsoftware/issrc/tree/main/Files/Languages/Unofficial
Name: "chinesesimplified"; MessagesFile: "languages\ChineseSimplified.isl"
Name: "chinesetraditional"; MessagesFile: "languages\ChineseTraditional.isl"

[CustomMessages]
; Uninstall cleanup dialog
english.UninstallCleanupPrompt=Would you like to remove your settings, search index, and saved credentials?
japanese.UninstallCleanupPrompt=設定、検索インデックス、保存された認証情報を削除しますか？
chinesesimplified.UninstallCleanupPrompt=是否要删除设置、搜索索引和已保存的凭据？
chinesetraditional.UninstallCleanupPrompt=是否要刪除設定、搜尋索引和已儲存的憑證？
english.UninstallCleanupFailed=Failed to delete application data. You may need to remove it manually at:
japanese.UninstallCleanupFailed=アプリケーションデータの削除に失敗しました。手動で削除する必要がある場合があります：
chinesesimplified.UninstallCleanupFailed=无法删除应用程序数据。您可能需要手动删除：
chinesetraditional.UninstallCleanupFailed=無法刪除應用程式資料。您可能需要手動刪除：
english.UninstallDataRemains=Your synced messages and blog data were not removed. You can find them at:%n%n%1
japanese.UninstallDataRemains=同期済みのメッセージとブログデータは削除されていません。以下のフォルダに残っています：%n%n%1
chinesesimplified.UninstallDataRemains=已同步的消息和博客数据未被删除，仍保存在以下位置：%n%n%1
chinesetraditional.UninstallDataRemains=已同步的訊息和部落格資料未被刪除，仍保存在以下位置：%n%n%1

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Source from PyInstaller output (SakaDesk folder)
Source: "..\..\dist\SakaDesk\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\dist\SakaDesk\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[UninstallDelete]
; Playwright can download a Chromium bundle at RUNTIME into
; {app}\_internal\playwright\driver\package\.local-browsers (~640 MB), which is
; NOT recorded in [Files]. Inno's uninstaller only removes tracked files, so
; without this it orphans that bundle and can't remove the (now non-empty)
; {app}. XREPO-03: force-remove only the app-owned {app}\_internal subtree (the
; PyInstaller bundle dir, which is where the runtime download lands) rather than
; the whole {app}. Once _internal is gone, Inno removes the remaining tracked
; files and the now-empty {app} normally. Constraining the DelTree to _internal
; (plus DisableDirPage=yes above) means the uninstaller can never recursively
; wipe an unrelated directory the user might have chosen. No user data lives
; under {app} — settings/index/logs are in {localappdata}\SakaDesk and
; session/auth data in {userappdata}\pysaka, both cleaned in [Code] below.
; Runs only during uninstall, never during an in-place upgrade.
Type: filesandordirs; Name: "{app}\_internal"

[Run]
; Interactive install: checkbox to launch after install (skipped in silent mode)
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
; Silent install (/SILENT): always relaunch after upgrade completes
Filename: "{app}\{#MyAppExeName}"; Flags: nowait postinstall; Check: IsSilentInstall

[Code]
function IsSilentInstall: Boolean;
begin
  Result := WizardSilent;
end;

// Runs after CloseApplications, before any files are replaced. The app's DLLs in
// {app}\_internal stay memory-mapped (locked) until every SakaDesk process exits
// -- including the headless ProcessPoolExecutor index-build worker, which has no
// window, so Restart Manager (CloseApplications) cannot close it and may leave
// the main window running too. Belt-and-suspenders, and never a force-kill:
//   1. Post WM_CLOSE to the app window so it runs its OWN graceful shutdown
//      (which kills its worker processes, then os._exit releases the mutex).
//      This is exactly what clicking the window's X does -- state is saved, no
//      data loss.
//   2. Wait for the instance mutex to clear (a cleared mutex means the whole
//      process tree is gone).
//   3. If it still won't exit, ABORT with an actionable message BEFORE touching
//      any files. A clean stop the user can fix beats a silent mid-install
//      rollback (which is what happens if we plow ahead into locked DLLs).
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Wnd: HWND;
  Waited: Integer;
begin
  Result := '';

  // 1. Graceful nudge. Exact caption match: the app window is titled "SakaDesk";
  //    this installer's window is not, so we never message ourselves.
  Wnd := FindWindowByWindowName('SakaDesk');
  if Wnd <> 0 then
    PostMessage(Wnd, $0010, 0, 0);  // $0010 = WM_CLOSE

  // 2. Wait up to ~12s for the graceful shutdown (uvicorn stop + worker kills)
  //    to release the mutex.
  Waited := 0;
  while (Waited < 24) and CheckForMutexes('SakaDeskInstanceMutex') do
  begin
    Sleep(500);
    Waited := Waited + 1;
  end;
  // Extra grace so the OS can unmap the freed executable images.
  Sleep(500);

  // 3. Still alive? Stop cleanly instead of rolling back mid-install.
  if CheckForMutexes('SakaDeskInstanceMutex') then
    Result := 'SakaDesk is still running and could not be closed automatically.' + #13#10 +
              'Please close it (check the notification area and Task Manager for' + #13#10 +
              'SakaDesk.exe), then run Setup again.';
end;

// Write installer language choice to settings.json so the app uses it as default
procedure CurStepChanged(CurStep: TSetupStep);
var
  SettingsDir, SettingsFile, LangCode, Content: String;
begin
  if CurStep = ssPostInstall then
  begin
    // Map Inno Setup language name to SakaDesk i18n locale code
    if ActiveLanguage = 'japanese' then
      LangCode := 'ja'
    else if ActiveLanguage = 'chinesesimplified' then
      LangCode := 'zh-CN'
    else if ActiveLanguage = 'chinesetraditional' then
      LangCode := 'zh-TW'
    else
      LangCode := 'en';

    SettingsDir := ExpandConstant('{localappdata}\SakaDesk');
    if not DirExists(SettingsDir) then
      ForceDirectories(SettingsDir);

    SettingsFile := SettingsDir + '\settings.json';
    // Only write if settings.json doesn't exist yet (fresh install)
    if not FileExists(SettingsFile) then
    begin
      Content := '{"language": "' + LangCode + '"}';
      SaveStringToFile(SettingsFile, Content, False);
      Log('Wrote default language to settings: ' + LangCode);
    end;
  end;
end;

procedure DeleteCredential(Target: String);
var
  ResultCode: Integer;
begin
  Exec('cmdkey.exe', '/delete:' + Target, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

// Delete a pysaka credential group across every storage scheme the app has used.
// Current (pysaka >= 0.4.2): each credential has its OWN service "pysaka:<group>",
// which keyring's Windows backend stores at the bare target "pysaka:<group>" (and,
// once re-saved, a migrated copy at "credential@pysaka:<group>").
// Pre-0.4.2 (shared service "pysaka"): target "<group>@pysaka".
procedure DeletePysakaCredential(Group: String);
begin
  DeleteCredential('pysaka:' + Group);
  DeleteCredential('credential@pysaka:' + Group);
  DeleteCredential(Group + '@pysaka');
end;

// Read output_dir from settings.json (simple substring extraction, no JSON parser)
function ReadOutputDir(SettingsFile: String): String;
var
  Content: AnsiString;
  P, Q: Integer;
begin
  Result := '';
  if not FileExists(SettingsFile) then Exit;
  if not LoadStringFromFile(SettingsFile, Content) then Exit;
  P := Pos('"output_dir"', Content);
  if P = 0 then Exit;
  // Find the colon after the key, then the opening quote of the value
  P := Pos(':', Copy(Content, P, Length(Content)));
  if P = 0 then Exit;
  P := Pos('"', Copy(Content, P + Pos(':', Copy(Content, Pos('"output_dir"', Content), Length(Content))), Length(Content)));
  // Simpler approach: find "output_dir" then extract between next pair of quotes after colon
  Result := '';
  Content := Copy(Content, Pos('"output_dir"', Content) + Length('"output_dir"'), Length(Content));
  // Skip to colon
  P := Pos(':', Content);
  if P = 0 then Exit;
  Content := Copy(Content, P + 1, Length(Content));
  // Skip to opening quote
  P := Pos('"', Content);
  if P = 0 then Exit;
  Content := Copy(Content, P + 1, Length(Content));
  // Read until closing quote
  Q := Pos('"', Content);
  if Q = 0 then Exit;
  Result := Copy(Content, 1, Q - 1);
  // Unescape backslashes (JSON uses \\ for \)
  StringChangeEx(Result, '\\', '\', True);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
  pysakaDir: String;
  pyzakaDir: String;
  OutputDir: String;
  SettingsFile: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    // Destructive cleanup requires a real, interactive Yes. A silent
    // uninstall (/SILENT, /VERYSILENT, /SUPPRESSMSGBOXES) auto-answers
    // MsgBox with its DEFAULT button — without this guard that default was
    // Yes, so any scripted uninstall would silently wipe credentials + data.
    // MB_DEFBUTTON2 additionally makes "No" the default for any answer that
    // falls through to the default button.
    if (not UninstallSilent) and
       (MsgBox(CustomMessage('UninstallCleanupPrompt'),
               mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES) then
    begin
      // 1. Delete ALL credentials from Windows Credential Manager
      //
      // Current pysaka SDK credentials (pysaka/credentials.py, SERVICE_NAME="pysaka"):
      //   login sessions (per group) + the stored LLM/translation API key.
      DeletePysakaCredential('hinatazaka46');
      DeletePysakaCredential('sakurazaka46');
      DeletePysakaCredential('nogizaka46');
      DeletePysakaCredential('yodel');
      DeletePysakaCredential('llm_provider_api_key');
      //   Pre-0.4.2 shared-service bare target (username stored internally).
      DeleteCredential('pysaka');
      //
      // Legacy pyzaka SDK credentials (old SERVICE_NAME="pyzaka"):
      DeleteCredential('hinatazaka46@pyzaka');
      DeleteCredential('sakurazaka46@pyzaka');
      DeleteCredential('nogizaka46@pyzaka');
      DeleteCredential('yodel@pyzaka');
      DeleteCredential('pyzaka');
      //
      // Legacy SakaDesk credentials (credential_store.py, KEYRING_SERVICE="zakadesk"):
      //   from older app versions that used a separate credential store.
      DeleteCredential('access_token@zakadesk');
      DeleteCredential('app_id@zakadesk');
      DeleteCredential('config_json@zakadesk');
      DeleteCredential('config_chunks@zakadesk');
      DeleteCredential('zakadesk');
      Log('Removed all credentials from Windows Credential Manager.');

      // 2. Read output_dir from settings.json BEFORE deleting app data
      DataDir := ExpandConstant('{localappdata}\SakaDesk');
      if not DirExists(DataDir) then
        DataDir := ExpandConstant('{localappdata}\zakadesk');
      SettingsFile := DataDir + '\settings.json';
      OutputDir := ReadOutputDir(SettingsFile);

      // 3. Delete SakaDesk app data directory
      //    Contains: settings.json, search_index.db, logs/, webview/
      //    desktop.py releases SQLite + log handles on window close, but
      //    allow extra time for the process to fully exit after CloseApplications.
      Sleep(2000);
      if DirExists(DataDir) then
      begin
        if not DelTree(DataDir, True, True, True) then
        begin
          // Retry after another delay — Windows may still hold handles briefly
          Sleep(3000);
          if not DelTree(DataDir, True, True, True) then
            MsgBox(CustomMessage('UninstallCleanupFailed') + ' ' + DataDir, mbError, MB_OK)
          else
            Log('SakaDesk app data deleted (retry): ' + DataDir);
        end
        else
          Log('SakaDesk app data deleted: ' + DataDir);
      end;

      // 4. Delete pysaka shared auth data directory
      //    Contains: browser session data (OAuth cookies, Playwright profile)
      //    Location: %APPDATA%\pysaka  (legacy installs used %APPDATA%\pyzaka)
      pysakaDir := ExpandConstant('{userappdata}\pysaka');
      if DirExists(pysakaDir) then
      begin
        if DelTree(pysakaDir, True, True, True) then
          Log('pysaka auth data deleted: ' + pysakaDir)
        else
          Log('Failed to delete pysaka auth data at: ' + pysakaDir);
      end;
      pyzakaDir := ExpandConstant('{userappdata}\pyzaka');
      if DirExists(pyzakaDir) then
      begin
        if DelTree(pyzakaDir, True, True, True) then
          Log('pyzaka (legacy) auth data deleted: ' + pyzakaDir)
        else
          Log('Failed to delete pyzaka auth data at: ' + pyzakaDir);
      end;

      // 5. Notify user about remaining synced data
      if (OutputDir <> '') and DirExists(OutputDir) then
        MsgBox(FmtMessage(CustomMessage('UninstallDataRemains'), [OutputDir]),
               mbInformation, MB_OK);
    end;
  end;
end;
