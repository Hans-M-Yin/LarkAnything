using System;
using System.IO;
using System.Linq;
using System.Web.Script.Serialization;
class ResetLoginTests {
 static JavaScriptSerializer J=new JavaScriptSerializer();
 static void Assert(bool condition,string message) {if(!condition) throw new Exception(message);}
 static void Put(string path,object data) {Directory.CreateDirectory(Path.GetDirectoryName(path));File.WriteAllText(path,J.Serialize(data));}
 static void Login(string root,string id) {
  var profile=Path.Combine(root,"connections",id);
  Put(Path.Combine(root,"config.json"),new {version=1,stateDir="state",backends=new System.Collections.Generic.Dictionary<string,object>{{"lark-cli",new {configDir=profile}}}});
  Put(Path.Combine(profile,"config.json"),new {apps=new[]{new {appId=id,brand="feishu",appSecret=new {source="keychain",id="appsecret:"+id},users=new[]{new {userOpenId="ou_test"}}}}});
 }
 public static void Main(string[] args) {
  try {Test(args);} catch(Exception e) {Console.WriteLine(e.GetType().FullName);Console.WriteLine(e.Message);if(e.InnerException!=null)Console.WriteLine(e.InnerException.Message);Environment.ExitCode=1;}
 }
 static void Test(string[] args) {
  var test=Path.GetFullPath(args[0]);Directory.CreateDirectory(test);
  var root=Path.Combine(test,".larkanything");var ui=Path.Combine(test,"ui");
  Login(root,"cli_first");Put(Path.Combine(root,"state","receipt.json"),new {status="uncertain"});
  var receipt=File.ReadAllText(Path.Combine(root,"state","receipt.json"));
  var calls=0;var verified="";
  Func<string,string,int> cli=(dir,cmd)=>{calls++; Assert(File.ReadAllText(Path.Combine(dir,"config.json")).Contains("keychain"),"CLI must receive references");return 0;};
  Action<string[]> verify=accounts=>{verified=String.Join(",",accounts);};
  Directory.CreateDirectory(ui);File.WriteAllText(Path.Combine(ui,"local-storage"),"dismissed");
  LoginReset.Execute(root,ui,cli,verify);
  Assert(verified.Contains("appsecret:cli_first") && !Directory.Exists(ui),"first cleanup");
  Login(root,"cli_second");LoginReset.Execute(root,ui,cli,verify);
  Assert(verified.Contains("appsecret:cli_second") && !verified.Contains("cli_first"),"must reread new app after login");
  var before=calls;LoginReset.Execute(root,ui,cli,verify);Assert(calls==before,"empty repeat must succeed without CLI");
  Assert(File.ReadAllText(Path.Combine(root,"state","receipt.json"))==receipt,"receipts must survive");
  Login(root,"cli_retry");var profile=Path.Combine(root,"connections","cli_retry","config.json");
  var original=File.ReadAllText(profile);bool failed=false;
  try {LoginReset.Execute(root,ui,(dir,cmd)=>1,verify);}catch {failed=true;}
  Assert(failed && File.ReadAllText(profile)==original,"CLI failure must retain retry references");
  failed=false;try {LoginReset.Execute(root,ui,cli,accounts=>{throw new Exception("credential remains");});}catch{failed=true;}
  Assert(failed && File.ReadAllText(profile)==original,"verification failure must retain references");
  LoginReset.Execute(root,ui,cli,verify);
  var shared=Path.Combine(test,".lark-cli","config.json");Put(shared,new {apps=new[]{new {appId="cli_other"}}});
  var sharedBefore=File.ReadAllText(shared);Put(Path.Combine(root,"config.json"),new {version=1});
  failed=false;try{LoginReset.Execute(root,ui,cli,verify);}catch{failed=true;}
  Assert(failed && File.ReadAllText(shared)==sharedBefore,"shared profiles must be preserved");
  Console.WriteLine("PASS: new login detection, repeated reset, receipt preservation, CLI failure retry, credential verification, shared-profile protection.");
 }
}
