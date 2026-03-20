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

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[Code]
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
  pyzakaDir: String;
  OutputDir: String;
  SettingsFile: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    if MsgBox(CustomMessage('UninstallCleanupPrompt'),
              mbConfirmation, MB_YESNO) = IDYES then
    begin
      // 1. Delete ALL credentials from Windows Credential Manager
      //
      // pyzaka SDK credentials (pyzaka/credentials.py, SERVICE_NAME="pyzaka"):
      //   keyring v25+ WinVaultKeyring: target="{username}@{service}"
      DeleteCredential('hinatazaka46@pyzaka');
      DeleteCredential('sakurazaka46@pyzaka');
      DeleteCredential('nogizaka46@pyzaka');
      DeleteCredential('yodel@pyzaka');
      //   Old keyring: target="{service}" (username stored internally)
      DeleteCredential('pyzaka');
      //
      // SakaDesk credentials (credential_store.py, KEYRING_SERVICE="zakadesk"):
      //   These may exist from older app versions that used a separate credential store.
      //   keyring v25+: target="{key}@zakadesk"
      DeleteCredential('access_token@zakadesk');
      DeleteCredential('app_id@zakadesk');
      DeleteCredential('config_json@zakadesk');
      DeleteCredential('config_chunks@zakadesk');
      //   Old keyring: target="{service}"
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

      // 4. Delete pyzaka shared auth data directory
      //    Contains: browser session data (OAuth cookies, Playwright profile)
      //    Location: %APPDATA%\pyzaka
      pyzakaDir := ExpandConstant('{userappdata}\pyzaka');
      if DirExists(pyzakaDir) then
      begin
        if DelTree(pyzakaDir, True, True, True) then
          Log('pyzaka auth data deleted: ' + pyzakaDir)
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
