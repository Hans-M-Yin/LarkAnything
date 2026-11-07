// Repeatable first-run reset. Run from the user's normal Windows desktop.
// The CLI owns credential deletion; this tool never reads credential values.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

public static class LoginReset {
 static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
 static Dictionary<string,object> Read(string path) {
  return File.Exists(path) ? Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(path)) : new Dictionary<string,object>();
 }
 static string Str(Dictionary<string,object> obj, string key, string fallback) {
  object value; return obj.TryGetValue(key,out value) && value is string ? (string)value : fallback;
 }
 static Dictionary<string,object> Obj(Dictionary<string,object> obj, string key) {
  object value; return obj.TryGetValue(key,out value) && value is Dictionary<string,object> ? (Dictionary<string,object>)value : new Dictionary<string,object>();
 }
 static object[] Items(Dictionary<string,object> obj, string key) {
  object value;
  if(!obj.TryGetValue(key,out value)) return new object[0];
  var items=value as System.Collections.IList;
  if(items==null) throw new Exception("配置列表格式异常，已停止清理。");
  return items.Cast<object>().ToArray();
 }
 static void Save(string path, object value) {
  var temp=path+".reset-tmp";
  NoLinks(path); NoLinks(temp);
  File.WriteAllText(temp,Json.Serialize(value),new UTF8Encoding(false));
  if(File.Exists(path)) File.Replace(temp,path,null); else File.Move(temp,path);
 }
 static bool EqualPath(string a, string b) {return String.Equals(Path.GetFullPath(a).TrimEnd('\\'),Path.GetFullPath(b).TrimEnd('\\'),StringComparison.OrdinalIgnoreCase);}
 static void NoLinks(string path) {
  var current=Path.GetFullPath(path);
  while(!String.IsNullOrEmpty(current)) {
   if((Directory.Exists(current)||File.Exists(current)) && (File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)
    throw new Exception("路径包含链接或重解析点，已停止清理："+current);
   current=Path.GetDirectoryName(current);
  }
 }
 static void CheckTree(string path) {
  NoLinks(path);
  if(!Directory.Exists(path)) return;
  foreach(var entry in Directory.GetFileSystemEntries(path)) {
   NoLinks(entry);
   if(Directory.Exists(entry)) CheckTree(entry);
  }
 }
 static void DeleteTree(string path) {
  CheckTree(path); if(Directory.Exists(path)) Directory.Delete(path,true);
 }
 public static void Execute(string root, string userData, Func<string,string,int> run, Action<string[]> verify) {
  root=Path.GetFullPath(root);
  NoLinks(root); CheckTree(userData);
  Directory.CreateDirectory(root);
  var configPath=Path.Combine(root,"config.json"); NoLinks(configPath);
  var config=Read(configPath);
  var backend=Obj(Obj(config,"backends"),"lark-cli");
  var profile=Str(backend,"configDir",null);
  // Never wipe a shared ~/.lark-cli profile implicitly. Current desktop setup
  // creates one profile directly under ~/.larkanything/connections/.
  if(profile!=null && (!Path.IsPathRooted(profile) || !EqualPath(Path.GetDirectoryName(profile),Path.Combine(root,"connections"))))
   throw new Exception("当前连接使用外部 CLI 配置目录，已停止，以免清除其他程序的登录。");
  if(profile==null) {
   var shared=Path.Combine(Path.GetDirectoryName(root),".lark-cli","config.json");
   if(Items(Read(shared),"apps").Length!=0)
    throw new Exception("当前使用共享飞书 CLI 配置。请先在 App 中配置独立连接，再使用此测试清理工具。");
   profile=Path.Combine(root,"connections","reset-empty");
  }
  CheckTree(profile);
  var work=Path.Combine(root,"reset-login-work"); CheckTree(work);
  foreach(var file in new[]{"desktop.json","desktop-diagnostics.json"}) NoLinks(Path.Combine(root,file));
  var publicApps=new List<object>(); var accounts=new List<string>();
  foreach(var item in Items(Read(Path.Combine(profile,"config.json")),"apps")) {
   var app=(Dictionary<string,object>)item;
   var appId=Str(app,"appId",""); var secret=Obj(app,"appSecret");
   if(!appId.StartsWith("cli_",StringComparison.Ordinal) || Str(secret,"source","")!="keychain" || Str(secret,"id","")!="appsecret:"+appId)
    throw new Exception("应用凭证不是受支持的系统凭证引用，未进行清理。");
   var users=new List<object>(); accounts.Add("appsecret:"+appId);
   foreach(var entry in Items(app,"users")) {
    var id=Str((Dictionary<string,object>)entry,"userOpenId","");
    if(String.IsNullOrEmpty(id)) throw new Exception("登录记录缺少用户标识，未进行清理。");
    users.Add(new {userOpenId=id,userName=""}); accounts.Add(appId+":"+id);
   }
   // Explicit projection: only identifiers, never secrets/tokens or arbitrary fields.
   publicApps.Add(new {appId=appId,brand=Str(app,"brand","feishu"),appSecret=new {source="keychain",id="appsecret:"+appId},users=users});
  }
  Directory.CreateDirectory(work);
  try {
   if(publicApps.Count!=0) {
    foreach(var app in publicApps) {
     Save(Path.Combine(work,"config.json"),new {apps=new[]{app}});
     run(work,"auth logout --json"); // Best-effort remote revocation.
    }
    Save(Path.Combine(work,"config.json"),new {apps=publicApps});
    if(run(work,"config remove")!=0) throw new Exception("飞书 CLI 清理失败，请保留当前配置并重试。");
    // CLI remove can suppress keychain errors. Require independent verification.
    verify(accounts.ToArray());
   }
   // Original public references survive a CLI failure, so the next attempt can
   // retry. Clear them only after credential absence has been verified.
   Directory.CreateDirectory(profile);
   Save(Path.Combine(profile,"config.json"),new {apps=new object[0]});
   foreach(var folder in new[]{"cache","logs"}) DeleteTree(Path.Combine(profile,folder));
   DeleteTree(userData);
   foreach(var file in new[]{"desktop.json","desktop-diagnostics.json"}) File.Delete(Path.Combine(root,file));
   Save(configPath,new {version=1,stateDir=Str(config,"stateDir","state"),backends=new Dictionary<string,object>{
    {"lark-cli",new {identity="user",executable="lark-cli",configDir=profile}}
   }});
   // state/, previews, source apps, browser cookies, and cloud documents untouched.
  } finally {DeleteTree(work);}
 }

 static int Run(string cli, string profile, string args) {
  var start=new ProcessStartInfo(cli,args) {UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};
  start.EnvironmentVariables["LARKSUITE_CLI_CONFIG_DIR"]=profile;
  start.EnvironmentVariables.Remove("LARKSUITE_CLI_PROFILE");
  using(var p=Process.Start(start)) {
   p.OutputDataReceived+=(s,e)=>{}; p.ErrorDataReceived+=(s,e)=>{};
   p.BeginOutputReadLine(); p.BeginErrorReadLine();
   if(!p.WaitForExit(45000)) {p.Kill();p.WaitForExit();return -1;}
   p.WaitForExit(); return p.ExitCode;
  }
 }
 static void Verify(string[] accounts) {
  using(var key=Registry.CurrentUser.OpenSubKey(@"Software\LarkCli\keychain\lark-cli")) {
   if(key==null) return;
   var names=key.GetValueNames();
   foreach(var account in accounts) {
    var name=Convert.ToBase64String(Encoding.UTF8.GetBytes(account)).TrimEnd('=').Replace('+','-').Replace('/','_');
    if(Array.IndexOf(names,name)>=0) throw new Exception("系统凭证仍存在，清理尚未完成，请从正常 Windows 桌面重试。");
   }
  }
 }
 [STAThread] public static void Main() {
  var result=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"reset-login-desktop-result.json");
  try {
   if(Process.GetProcessesByName("LarkAnything").Length!=0) throw new Exception("请先完全退出 LarkAnything，再运行清理工具。");
   var root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),".larkanything");
   var local=Path.Combine(root,@"tools\node_modules\@larksuite\cli\bin\lark-cli.exe");
   var bundled=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,@"resources\lark-cli\lark-cli.exe");
   var cli=File.Exists(bundled)?bundled:local;
   Execute(root,Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),"larkanything"),
    (dir,args)=>Run(cli,dir,args),Verify);
   Save(result,new {credentialsCleared=true,firstRunReset=true,cloudDocumentsDeleted=false,receiptsDeleted=false,completedAt=DateTime.UtcNow.ToString("o")});
   MessageBox.Show("当前连接的本地登录凭证和首次引导已清除。\n\n重新打开 LarkAnything 即可从头配置。云端文档和上传回执已保留。\n\n本工具可以重复使用。", "LarkAnything 清理完成",MessageBoxButtons.OK,MessageBoxIcon.Information);
  } catch(Exception e) {
   try {Save(result,new {credentialsCleared=false,completedAt=DateTime.UtcNow.ToString("o")});} catch {}
   MessageBox.Show(e.Message,"LarkAnything 清理未完成",MessageBoxButtons.OK,MessageBoxIcon.Error);
  }
 }
}
