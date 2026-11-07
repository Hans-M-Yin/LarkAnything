// Local-only integration fixture. Never bundled with the application.
using System;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
class FixtureCli {
  static JavaScriptSerializer json = new JavaScriptSerializer();
  static string root = AppDomain.CurrentDomain.BaseDirectory;
  static void Print(object value) { Console.WriteLine(json.Serialize(value)); }
  static bool Has(string[] args, string value) { return Array.IndexOf(args,value)>=0; }
  static int Main(string[] args) {
    Console.OutputEncoding = new UTF8Encoding(false);
    Console.InputEncoding = Encoding.UTF8;
    string input = Console.In.ReadToEnd();
    File.AppendAllText(Path.Combine(root,"calls.jsonl"),json.Serialize(new {args=args,input=input})+"\n",Encoding.UTF8);
    if(Has(args,"--version")) {Console.WriteLine("1.9.0");return 0;}
    if(Has(args,"list")) {Print(new[]{new {id="ses_fixture",title="OpenCode fixture",directory=root,time=new {updated=1780000000000L}}});return 0;}
    if(Has(args,"export")) {Print(new {info=new {id="ses_fixture",title="OpenCode fixture"},messages=new[]{new {info=new {id="msg_fixture",role="user"},parts=new[]{new {type="text",text="OpenCode public message"}}}}});return 0;}
    if (Has(args,"status")) { Print(new {appId="cli_fixture",brand="feishu",identities=new {bot=new {available=true},user=new {available=true,status="ready"}}}); return 0; }
    if (Has(args,"init")) { Console.Error.WriteLine("https://fixture.feishu.cn/setup"); Console.Error.Flush(); System.Threading.Thread.Sleep(15000); return 0; }
    if (File.Exists(Path.Combine(root,"delay"))) System.Threading.Thread.Sleep(10000);
    if (Has(args,"+create") && !Has(args,"--dry-run")) {
      if (File.Exists(Path.Combine(root,"uncertain"))) {Console.Error.WriteLine("{\"error\":{\"type\":\"authorization\",\"subtype\":\"scope_missing\"}}");return 3;}
      File.WriteAllText(Path.Combine(root,"document.md"),input,new UTF8Encoding(false));
      Print(new {ok=true,data=new {document=new {document_id="fixture_doc",url="https://fixture.feishu.cn/docx/fixture_doc"}}});return 0;
    }
    if (Has(args,"+fetch")) {Print(new {ok=true,data=new {document=new {document_id="fixture_doc",content=File.ReadAllText(Path.Combine(root,"document.md"),Encoding.UTF8)}}});return 0;}
    Print(new {ok=true,data=new {}});return 0;
  }
}
