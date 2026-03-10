; Inno Setup Script for HakoDesk
; Creates a Windows installer package

#define MyAppName "HakoDesk"
; Version can be overridden via command line: iscc /DAppVersion=1.2.3 setup.iss
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
#define MyAppVersion AppVersion
#define MyAppPublisher "xtorker"
#define MyAppURL "https://github.com/xtorker/Project-PyHako"
#define MyAppExeName "HakoDesk.exe"

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
OutputBaseFilename=HakoDesk-{#MyAppVersion}-Setup
SetupIconFile=HakoDesk.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
; Show language selection dialog at install
ShowLanguageDialog=yes
; Close running HakoDesk before install/uninstall
CloseApplications=yes
CloseApplicationsFilter=*.exe

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"
; Chinese ISL files are unofficial translations bundled locally
; Source: https://github.com/jrsoftware/issrc/tree/main/Files/Languages/Unofficial
Name: "chinesesimplified"; MessagesFile: "languages\ChineseSimplified.isl"
Name: "chinesetraditional"; MessagesFile: "languages\ChineseTraditional.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Source from PyInstaller output (HakoDesk folder)
Source: "..\..\dist\HakoDesk\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\dist\HakoDesk\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

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
    // Map Inno Setup language name to HakoDesk i18n locale code
    if ActiveLanguage = 'japanese' then
      LangCode := 'ja'
    else if ActiveLanguage = 'chinesesimplified' then
      LangCode := 'zh-CN'
    else if ActiveLanguage = 'chinesetraditional' then
      LangCode := 'zh-TW'
    else
      LangCode := 'en';

    SettingsDir := ExpandConstant('{localappdata}\HakoDesk');
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

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
  PyHakoDir: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    if MsgBox('Would you like to completely remove your personal data and configuration files?' + #13#10 + #13#10 +
              'This includes cached messages, settings, and saved credentials.',
              mbConfirmation, MB_YESNO) = IDYES then
    begin
      // 1. Delete ALL credentials from Windows Credential Manager
      //
      // PyHako SDK credentials (pyhako/credentials.py, SERVICE_NAME="pyhako"):
      //   keyring v25+ WinVaultKeyring: target="{username}@{service}"
      DeleteCredential('hinatazaka46@pyhako');
      DeleteCredential('sakurazaka46@pyhako');
      DeleteCredential('nogizaka46@pyhako');
      DeleteCredential('yodel@pyhako');
      //   Old keyring: target="{service}" (username stored internally)
      DeleteCredential('pyhako');
      //
      // HakoDesk credentials (credential_store.py, KEYRING_SERVICE="hakodesk"):
      //   These may exist from older app versions that used a separate credential store.
      //   keyring v25+: target="{key}@hakodesk"
      DeleteCredential('access_token@hakodesk');
      DeleteCredential('app_id@hakodesk');
      DeleteCredential('config_json@hakodesk');
      DeleteCredential('config_chunks@hakodesk');
      //   Old keyring: target="{service}"
      DeleteCredential('hakodesk');
      Log('Removed all credentials from Windows Credential Manager.');

      // 3. Delete HakoDesk app data directory
      //    Contains: settings.json, search_index.db, logs/, webview/
      //    desktop.py releases SQLite + log handles on window close, but
      //    allow extra time for the process to fully exit after CloseApplications.
      Sleep(2000);
      DataDir := ExpandConstant('{localappdata}\HakoDesk');
      // Also try legacy lowercase name from older versions
      if not DirExists(DataDir) then
        DataDir := ExpandConstant('{localappdata}\hakodesk');
      if DirExists(DataDir) then
      begin
        if not DelTree(DataDir, True, True, True) then
        begin
          // Retry after another delay — Windows may still hold handles briefly
          Sleep(3000);
          if not DelTree(DataDir, True, True, True) then
            MsgBox('Failed to delete application data. You may need to remove it manually at: ' + DataDir, mbError, MB_OK)
          else
            Log('HakoDesk app data deleted (retry): ' + DataDir);
        end
        else
          Log('HakoDesk app data deleted: ' + DataDir);
      end;

      // 4. Delete PyHako shared auth data directory
      //    Contains: browser session data (OAuth cookies, Playwright profile)
      //    Location: %APPDATA%\pyhako
      PyHakoDir := ExpandConstant('{userappdata}\pyhako');
      if DirExists(PyHakoDir) then
      begin
        if DelTree(PyHakoDir, True, True, True) then
          Log('PyHako auth data deleted: ' + PyHakoDir)
        else
          Log('Failed to delete PyHako auth data at: ' + PyHakoDir);
      end;
    end;
  end;
end;
