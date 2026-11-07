#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod credentials;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{BufRead, Write},
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, UNIX_EPOCH},
};
use tauri::{Manager, State};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::mpsc,
};

type Result<T> = std::result::Result<T, Value>;
fn failure(message: impl ToString, code: &str) -> Value {
    json!({"message":message.to_string(),"code":code})
}
fn io_error(error: std::io::Error) -> Value {
    let code = match error.kind() {
        std::io::ErrorKind::NotFound => "ENOENT",
        std::io::ErrorKind::AlreadyExists => "EEXIST",
        std::io::ErrorKind::PermissionDenied => "EACCES",
        _ => "EIO",
    };
    failure(error, code)
}
fn string<'a>(args: &'a Value, key: &str) -> Result<&'a str> {
    args[key]
        .as_str()
        .ok_or_else(|| failure("Invalid argument", "EINVAL"))
}
#[derive(Default)]
struct Output {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    done: bool,
    code: Option<i32>,
    killed: bool,
    bytes: usize,
}
struct Running {
    output: Arc<Mutex<Output>>,
    kill: mpsc::Sender<()>,
}
struct NativeState {
    root: PathBuf,
    home: PathBuf,
    state_dir: PathBuf,
    bundled_cli: Option<PathBuf>,
    selected: Mutex<Vec<PathBuf>>,
    locks: Mutex<HashMap<String, File>>,
    children: Mutex<HashMap<String, Running>>,
    compact: Mutex<Option<(tauri::PhysicalSize<u32>, tauri::PhysicalPosition<i32>)>>,
}
fn read_json(path: &Path) -> Value {
    fs::read(path)
        .ok()
        .and_then(|v| serde_json::from_slice(&v).ok())
        .unwrap_or(Value::Null)
}
// Resolve existing ancestors as well as lexical '..': symlinks cannot escape a granted root.
fn canonical(path: &Path) -> std::io::Result<PathBuf> {
    let mut normalized = PathBuf::new();
    for part in path.components() {
        match part {
            Component::ParentDir => {
                normalized.pop();
            }
            Component::CurDir => {}
            _ => normalized.push(part),
        }
    }
    if normalized.exists() {
        return normalized.canonicalize();
    }
    let name = normalized
        .file_name()
        .ok_or_else(|| std::io::Error::other("Invalid path"))?;
    let parent = normalized
        .parent()
        .ok_or_else(|| std::io::Error::other("Invalid parent"))?;
    Ok(canonical(parent)?.join(name))
}
impl NativeState {
    fn config(&self) -> Value {
        read_json(&self.root.join("config.json"))
    }
    fn path(&self, raw: &str, write: bool) -> Result<PathBuf> {
        let requested = Path::new(raw);
        if !requested.is_absolute() {
            return Err(failure("Absolute path required", "EACCES"));
        }
        let path = canonical(requested).map_err(io_error)?;
        let mut allowed = vec![self.root.clone(), self.state_dir.clone()];
        if !write {
            allowed.extend([self.home.join(".codex"), self.home.join(".claude")]);
            for key in ["CODEX_HOME", "CLAUDE_CONFIG_DIR"] {
                if let Some(v) = std::env::var_os(key) {
                    allowed.push(PathBuf::from(v));
                }
            }
            let desktop = read_json(&self.root.join("desktop.json"));
            for key in ["vault", "codexHome", "claudeHome"] {
                if let Some(v) = desktop[key].as_str().filter(|v| !v.is_empty()) {
                    allowed.push(PathBuf::from(v));
                }
            }
            allowed.extend(self.selected.lock().unwrap().iter().cloned());
        }
        if allowed
            .iter()
            .filter_map(|p| canonical(p).ok())
            .any(|root| path.starts_with(root))
        {
            Ok(path)
        } else {
            Err(failure(
                "Path outside configured LarkAnything locations",
                "EACCES",
            ))
        }
    }
    fn executable(&self, requested: &str) -> Result<PathBuf> {
        let config = self.config();
        let configured = config["backends"]["lark-cli"]["executable"]
            .as_str()
            .unwrap_or("lark-cli");
        let bundled = self.bundled_cli.as_ref().filter(|p| p.is_file());
        // The web worker can request only the saved executable or this exact
        // native-resolved resource while the default component is selected.
        if configured == "lark-cli" {
            if let Some(path) = bundled {
                if requested == "lark-cli" || Path::new(requested) == path {
                    return Ok(path.clone());
                }
            }
        }
        if requested != configured {
            return Err(failure("CLI does not match saved configuration", "EACCES"));
        }
        if requested != "lark-cli" {
            let path = PathBuf::from(requested);
            if cfg!(windows)
                && path
                    .extension()
                    .and_then(|s| s.to_str())
                    .map(|s| s.eq_ignore_ascii_case("exe"))
                    != Some(true)
            {
                return Err(failure(
                    "Select the native lark-cli.exe, not a shell wrapper",
                    "EINVAL",
                ));
            }
            return Ok(path);
        }
        let name = if cfg!(windows) {
            "lark-cli.exe"
        } else {
            "lark-cli"
        };
        let mut candidates = vec![self
            .home
            .join(".larkanything/tools/node_modules/@larksuite/cli/bin")
            .join(name)];
        if let Some(paths) = std::env::var_os("PATH") {
            candidates.extend(std::env::split_paths(&paths).map(|p| p.join(name)));
        }
        if !cfg!(windows) {
            candidates.extend([
                PathBuf::from("/opt/homebrew/bin/lark-cli"),
                PathBuf::from("/usr/local/bin/lark-cli"),
            ]);
        }
        candidates.into_iter().find(|p| p.is_file()).ok_or_else(|| {
            failure(
                "External Feishu CLI not found; select it in settings",
                "ENOENT",
            )
        })
    }
}
fn checked_window(window: &tauri::WebviewWindow) -> Result<()> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(failure("Invalid window", "EACCES"))
    }
}
#[tauri::command]
fn bootstrap(window: tauri::WebviewWindow, state: State<NativeState>) -> Result<Value> {
    checked_window(&window)?;
    let env: HashMap<String, String> = ["CODEX_HOME", "CLAUDE_CONFIG_DIR"]
        .iter()
        .filter_map(|key| std::env::var(key).ok().map(|v| (key.to_string(), v)))
        .collect();
    Ok(
        json!({"home":state.home,"root":state.root,"cwd":state.home,"pid":std::process::id(),"platform":if cfg!(windows) {"win32"} else if cfg!(target_os="macos") {"darwin"} else {"linux"},"env":env,"bundledExecutable":state.bundled_cli}),
    )
}
fn create_file(path: &Path, exclusive: bool) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true);
    if exclusive {
        options.create_new(true);
    } else {
        options.create(true).truncate(true);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}
fn decode(bytes: &mut Vec<u8>, done: bool) -> String {
    let length = if done {
        bytes.len()
    } else {
        match std::str::from_utf8(bytes) {
            Ok(_) => bytes.len(),
            Err(e) if e.error_len().is_none() => e.valid_up_to(),
            Err(_) => bytes.len(),
        }
    };
    String::from_utf8_lossy(&bytes.drain(..length).collect::<Vec<_>>()).into_owned()
}
async fn collect<R: AsyncRead + Unpin>(
    mut reader: R,
    output: Arc<Mutex<Output>>,
    stderr: bool,
    limit: usize,
    kill: mpsc::Sender<()>,
) {
    let mut chunk = [0_u8; 8192];
    loop {
        let n = match reader.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        let overflow = {
            let mut value = output.lock().unwrap();
            value.bytes += n;
            if value.bytes > limit {
                value.killed = true;
                true
            } else {
                if stderr {
                    value.stderr.extend_from_slice(&chunk[..n]);
                } else {
                    value.stdout.extend_from_slice(&chunk[..n]);
                }
                false
            }
        };
        if overflow {
            let _ = kill.try_send(());
            break;
        }
    }
}
async fn start_process(state: &NativeState, args: &Value) -> Result<Value> {
    let is_opencode = string(args, "executable")? == "opencode";
    let executable = if is_opencode {
        let desktop = read_json(&state.root.join("desktop.json"));
        let configured = desktop["opencodeExecutable"].as_str().unwrap_or("");
        if configured.is_empty() { PathBuf::from(if cfg!(windows) {"opencode.exe"} else {"opencode"}) }
        else {
            let path = PathBuf::from(configured);
            if !path.is_absolute() || (cfg!(windows) && path.extension().and_then(|s|s.to_str()) != Some("exe")) {
                return Err(failure("请选择 OpenCode 原生可执行文件", "EINVAL"));
            }
            path
        }
    } else { state.executable(string(args, "executable")?)? };
    let arguments: Vec<String> = serde_json::from_value(args["args"].clone())
        .map_err(|_| failure("Invalid CLI arguments", "EINVAL"))?;
    let allowed = matches!(
        (
            arguments.first().map(String::as_str),
            arguments.get(1).map(String::as_str)
        ),
        (Some("auth"), Some("status" | "login"))
            | (Some("config"), Some("init"))
            | (
                Some("docs"),
                Some("+search" | "+create" | "+update" | "+fetch")
            )
    );
    let allowed = if is_opencode {
        arguments == ["--version"] || arguments == ["session","list","--format","json"] ||
        ((arguments.len()==2 && arguments[0]=="export") || (arguments.len()==3 && arguments[0]=="session" && arguments[1]=="export")) &&
        arguments.last().is_some_and(|id| id.starts_with("ses_") && id.chars().all(|c| c.is_ascii_alphanumeric() || c=='_'))
    } else { allowed };
    if !allowed {
        return Err(failure("Unsupported CLI command", "EACCES"));
    }
    let mut command = Command::new(executable);
    command
        .args(arguments)
        .current_dir(&state.home)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    if let Some(config_dir) = args["configDir"].as_str() {
        let config = state.config();
        let existing = config["backends"]["lark-cli"]["configDir"].as_str();
        if Some(config_dir) != existing {
            state.path(config_dir, true)?;
        }
        command.env("LARKSUITE_CLI_CONFIG_DIR", config_dir);
    }
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command.spawn().map_err(io_error)?;
    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let input = args["input"].as_str().unwrap_or("").as_bytes().to_vec();
    let timeout = args["timeout"]
        .as_u64()
        .unwrap_or(120000)
        .clamp(1000, 900000);
    let limit = args["limit"].as_u64().unwrap_or(33554432).min(33554432) as usize;
    let handle = uuid::Uuid::new_v4().to_string();
    let output = Arc::new(Mutex::new(Output::default()));
    let (kill, mut stop) = mpsc::channel(1);
    state.children.lock().unwrap().insert(
        handle.clone(),
        Running {
            output: output.clone(),
            kill: kill.clone(),
        },
    );
    tauri::async_runtime::spawn(async move {
        let writer = tauri::async_runtime::spawn(async move {
            let _ = stdin.write_all(&input).await;
            let _ = stdin.shutdown().await;
        });
        let out = tauri::async_runtime::spawn(collect(
            stdout,
            output.clone(),
            false,
            limit,
            kill.clone(),
        ));
        let err = tauri::async_runtime::spawn(collect(stderr, output.clone(), true, limit, kill));
        let status = tokio::select! {
            status=child.wait()=>status,
            _=tokio::time::sleep(Duration::from_millis(timeout))=>{output.lock().unwrap().killed=true;let _=child.kill().await;child.wait().await},
            _=stop.recv()=>{output.lock().unwrap().killed=true;let _=child.kill().await;child.wait().await},
        };
        writer.abort();
        let _ = out.await;
        let _ = err.await;
        let mut value = output.lock().unwrap();
        value.code = status.ok().and_then(|s| s.code());
        value.done = true;
    });
    Ok(json!(handle))
}
#[tauri::command]
async fn native(
    window: tauri::WebviewWindow,
    state: State<'_, NativeState>,
    op: String,
    args: Value,
) -> Result<Value> {
    checked_window(&window)?;
    if op == "process_start" {
        return start_process(&state, &args).await;
    }
    if op == "notion_credential" {
        return match string(&args, "action")? {
            "status" => Ok(json!({"saved": credentials::read(&state.root)?.is_some()})),
            "save" => {
                let token = string(&args, "token")?;
                if token.len() > 4096 || token.trim().is_empty() { return Err(failure("Notion 令牌无效", "EINVAL")); }
                credentials::save(&state.root, token)?;
                Ok(Value::Null)
            },
            "delete" => { credentials::delete(&state.root)?; Ok(Value::Null) },
            _ => Err(failure("Unsupported credential action", "EACCES")),
        };
    }
    if op == "notion" {
        let saved;
        let token = if let Some(candidate) = args["token"].as_str() { candidate } else {
            saved = credentials::read(&state.root)?.ok_or_else(|| failure("请在设置中连接 Notion，并为所需页面添加该连接。", "ENOTION_AUTH"))?;
            &saved
        };
        if token.len() > 4096 || token.trim().is_empty() { return Err(failure("Notion 令牌无效", "EINVAL")); }
        let client = reqwest::Client::builder().timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none()).build().map_err(|_|failure("无法初始化 Notion 连接","ENET"))?;
        let request = match string(&args, "action")? {
            "list" => {
                let mut body=json!({"page_size":100,"filter":{"property":"object","value":"page"},"sort":{"direction":"descending","timestamp":"last_edited_time"}});
                if let Some(cursor)=args["cursor"].as_str() {body["start_cursor"]=json!(cursor);}
                client.post("https://api.notion.com/v1/search").json(&body)
            },
            "read" => {
                let id=string(&args,"id")?;
                if uuid::Uuid::parse_str(id).is_err() {return Err(failure("Notion 页面 ID 无效","EINVAL"));}
                client.get(format!("https://api.notion.com/v1/pages/{id}/markdown"))
            },
            _ => return Err(failure("Unsupported Notion action","EACCES")),
        };
        let mut response=request.bearer_auth(token).header("Notion-Version","2026-03-11").send().await.map_err(|_|failure("Notion 网络连接失败或超时","ENET"))?;
        let status=response.status();
        if !status.is_success() {
            let message = match status.as_u16() {
                401 => "Notion 令牌无效或已撤销，请在设置中更新令牌。已保存的配置不会自动删除。".to_string(),
                403 | 404 => "Notion 页面不可访问，请检查集成权限和页面连接。".to_string(),
                429 => "Notion 请求过于频繁，请稍后重试。".to_string(),
                _ => format!("Notion 请求失败（{}），请稍后重试。",status.as_u16()),
            };
            return Err(failure(message,"ENOTION"));
        }
        if response.content_length().unwrap_or(0)>20*1024*1024 {return Err(failure("Notion 页面过大","EFBIG"));}
        let mut bytes=Vec::new();
        while let Some(chunk)=response.chunk().await.map_err(|_|failure("Notion 响应读取失败","ENET"))? {
            if bytes.len()+chunk.len()>20*1024*1024 {return Err(failure("Notion 页面过大","EFBIG"));}
            bytes.extend_from_slice(&chunk);
        }
        return serde_json::from_slice(&bytes).map_err(|_|failure("Notion 返回格式无效","EJSON"));
    }
    match op.as_str() {
        "process_poll" => {
            let handle = string(&args, "handle")?;
            let mut children = state.children.lock().unwrap();
            let process = children
                .get(handle)
                .ok_or_else(|| failure("Unknown process", "ENOENT"))?;
            let mut value = process.output.lock().unwrap();
            let done = value.done;
            let result = json!({"stdout":decode(&mut value.stdout,done),"stderr":decode(&mut value.stderr,done),"done":done,"code":value.code,"killed":value.killed});
            drop(value);
            if done {
                children.remove(handle);
            }
            Ok(result)
        }
        "process_kill" => {
            if let Some(process) = state.children.lock().unwrap().get(string(&args, "handle")?) {
                let _ = process.kill.try_send(());
            }
            Ok(Value::Null)
        }
        "lock_write" => {
            let mut locks = state.locks.lock().unwrap();
            let file = locks
                .get_mut(string(&args, "handle")?)
                .ok_or_else(|| failure("Lock closed", "EBADF"))?;
            file.write_all(string(&args, "data")?.as_bytes())
                .map_err(io_error)?;
            file.sync_all().map_err(io_error)?;
            Ok(Value::Null)
        }
        "lock_close" => {
            state.locks.lock().unwrap().remove(string(&args, "handle")?);
            Ok(Value::Null)
        }
        "open_url" => {
            let url = url::Url::parse(string(&args, "url")?)
                .map_err(|_| failure("Invalid link", "EINVAL"))?;
            let host = url.host_str().unwrap_or("");
            if url.scheme() != "https"
                || !url.username().is_empty()
                || url.password().is_some()
                || !["feishu.cn", "larksuite.com"]
                    .iter()
                    .any(|d| host == *d || host.ends_with(&format!(".{d}")))
            {
                return Err(failure(
                    "Only Feishu/Lark HTTPS links are allowed",
                    "EACCES",
                ));
            }
            open::that(url.as_str()).map_err(io_error)?;
            Ok(Value::Null)
        }
        _ => {
            let write = matches!(
                op.as_str(),
                "write" | "mkdir" | "rename" | "remove" | "lock_open"
            );
            let path = state.path(string(&args, "path")?, write)?;
            match op.as_str() {
                "read" => Ok(json!(fs::read_to_string(path).map_err(io_error)?)),
                "read_bytes" => {
                    if fs::metadata(&path).map_err(io_error)?.len()>20*1024*1024 {return Err(failure("文件超过 20 MB","EFBIG"));}
                    Ok(json!(fs::read(path).map_err(io_error)?))
                },
                "header" => {
                    let reader = std::io::BufReader::new(File::open(path).map_err(io_error)?);
                    for line in reader.lines() {
                        let line = line.map_err(io_error)?;
                        if !line.trim().is_empty() {
                            return Ok(json!(line));
                        }
                    }
                    Ok(Value::Null)
                }
                "write" => {
                    let mut file = create_file(&path, args["exclusive"].as_bool() == Some(true))
                        .map_err(io_error)?;
                    file.write_all(string(&args, "data")?.as_bytes())
                        .map_err(io_error)?;
                    file.sync_all().map_err(io_error)?;
                    Ok(Value::Null)
                }
                "mkdir" => {
                    let mut builder = fs::DirBuilder::new();
                    builder.recursive(args["recursive"].as_bool() == Some(true));
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::DirBuilderExt;
                        builder.mode(0o700);
                    }
                    builder.create(path).map_err(io_error)?;
                    Ok(Value::Null)
                }
                "rename" => {
                    let to = state.path(string(&args, "to")?, true)?;
                    fs::rename(path, to).map_err(io_error)?;
                    Ok(Value::Null)
                }
                "remove" => {
                    match fs::remove_file(path) {
                        Ok(()) => {}
                        Err(e)
                            if e.kind() == std::io::ErrorKind::NotFound
                                && args["force"] == true => {}
                        Err(e) => return Err(io_error(e)),
                    };
                    Ok(Value::Null)
                }
                "stat" => {
                    let meta = fs::metadata(path).map_err(io_error)?;
                    Ok(
                        json!({"size":meta.len(),"mtimeMs":meta.modified().map_err(io_error)?.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs_f64()*1000.0}),
                    )
                }
                "readdir" => {
                    let entries=fs::read_dir(path).map_err(io_error)?.map(|e|{let e=e.map_err(io_error)?;let t=e.file_type().map_err(io_error)?;Ok(json!({"name":e.file_name().to_string_lossy(),"file":t.is_file(),"directory":t.is_dir()}))}).collect::<Result<Vec<_>>>()?;
                    Ok(json!(entries))
                }
                "lock_open" => {
                    let file = create_file(&path, true).map_err(io_error)?;
                    let id = uuid::Uuid::new_v4().to_string();
                    state.locks.lock().unwrap().insert(id.clone(), file);
                    Ok(json!(id))
                }
                _ => Err(failure("Unsupported native operation", "EINVAL")),
            }
        }
    }
}
#[tauri::command]
async fn choose(
    window: tauri::WebviewWindow,
    state: State<'_, NativeState>,
    directory: bool,
    kind: Option<String>,
) -> Result<Value> {
    checked_window(&window)?;
    let dialog = rfd::AsyncFileDialog::new().set_title(if directory {
        "选择文件夹"
    } else {
        "选择飞书 CLI"
    });
    let dialog = match kind.as_deref() {
        Some("markdown") => dialog.set_title("选择 Markdown 文件").add_filter("Markdown", &["md"]),
        Some("docx") => dialog.set_title("选择 Word 文档").add_filter("Word", &["docx"]),
        Some(_) => return Err(failure("Unsupported file type","EINVAL")),
        None => dialog,
    };
    let chosen = if directory {
        dialog.pick_folder().await
    } else {
        dialog.pick_file().await
    };
    if let Some(file) = chosen {
        let path = file.path().to_path_buf();
        state.selected.lock().unwrap().push(path.clone());
        Ok(json!(path))
    } else {
        Ok(Value::Null)
    }
}
#[tauri::command]
fn window_mode(
    window: tauri::WebviewWindow,
    state: State<NativeState>,
    expanded: bool,
) -> Result<()> {
    checked_window(&window)?;
    let mut compact = state.compact.lock().unwrap();
    if expanded && compact.is_none() {
        let size = window.inner_size().map_err(|e| failure(e, "EWINDOW"))?;
        let pos = window.outer_position().map_err(|e| failure(e, "EWINDOW"))?;
        *compact = Some((size, pos));
        let scale = window.scale_factor().unwrap_or(1.0);
        let width = window
            .current_monitor()
            .ok()
            .flatten()
            .map(|m| (m.size().width as f64 / scale).min(860.0))
            .unwrap_or(860.0);
        window
            .set_size(tauri::LogicalSize::new(width, size.height as f64 / scale))
            .map_err(|e| failure(e, "EWINDOW"))?;
    } else if !expanded {
        if let Some((size, pos)) = compact.take() {
            window.set_size(size).map_err(|e| failure(e, "EWINDOW"))?;
            window
                .set_position(pos)
                .map_err(|e| failure(e, "EWINDOW"))?;
        }
    }
    Ok(())
}
#[tauri::command]
fn window_action(window: tauri::WebviewWindow, action: String) -> Result<()> {
    checked_window(&window)?;
    let result = match action.as_str() {
        "drag" => window.start_dragging(),
        "minimize" => window.minimize(),
        "maximize" => {
            if window.is_maximized().unwrap_or(false) {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        "close" => window.close(),
        _ => return Err(failure("Unknown window action", "EINVAL")),
    };
    result.map_err(|e| failure(e, "EWINDOW"))
}
fn main() {
    let home = dirs::home_dir().expect("Home directory unavailable");
    let mut root = home.join(".larkanything");
    #[cfg(debug_assertions)]
    if let Some(value) = std::env::var_os("LARKANYTHING_DESKTOP_HOME") {
        root = PathBuf::from(value);
    }
    fs::create_dir_all(&root).expect("Cannot open LarkAnything data directory");
    let config = read_json(&root.join("config.json"));
    let state_dir = root.join(config["stateDir"].as_str().unwrap_or("state"));
    let state = NativeState {
        root,
        home,
        state_dir,
        bundled_cli: None,
        selected: Mutex::new(vec![]),
        locks: Mutex::new(HashMap::new()),
        children: Mutex::new(HashMap::new()),
        compact: Mutex::new(None),
    };
    let builder = tauri::Builder::default();
    // Only debug fixtures with an isolated data root may coexist with the user app.
    let isolated_test = cfg!(debug_assertions) && std::env::var_os("LARKANYTHING_DESKTOP_HOME").is_some();
    let builder = if isolated_test { builder } else {
        builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
    };
    let app = builder
        .setup(move |app| {
            let mut state = state;
            // Debug fixtures always exercise their explicit fake CLI and never
            // discover the real packaged component or credentials by accident.
            if !cfg!(debug_assertions) {
                let name = if cfg!(windows) { "lark-cli.exe" } else { "lark-cli" };
                let path = app.path().resource_dir()?.join("lark-cli").join(name);
                if path.is_file() {
                    state.bundled_cli = Some(path);
                }
            }
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            native,
            choose,
            window_mode,
            window_action
        ])
        .build(tauri::generate_context!())
        .expect("Failed to start LarkAnything");
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let state = app.state::<NativeState>();
            for process in state.children.lock().unwrap().values() {
                let _ = process.kill.try_send(());
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packaged_cli_is_default_without_overriding_or_bypassing_saved_choice() {
        let root = std::env::temp_dir().join(format!("la-cli-resolver-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let bundled = root.join("bundled.exe");
        fs::write(&bundled, b"fixture").unwrap();
        let state = NativeState {
            root: root.clone(), home: root.clone(), state_dir: root.join("state"),
            bundled_cli: Some(bundled.clone()), selected: Mutex::new(vec![]),
            locks: Mutex::new(HashMap::new()), children: Mutex::new(HashMap::new()),
            compact: Mutex::new(None),
        };
        assert_eq!(state.executable("lark-cli").unwrap(), bundled);
        assert_eq!(state.executable(bundled.to_str().unwrap()).unwrap(), bundled);
        let other = root.join("other.exe");
        assert_eq!(state.executable(other.to_str().unwrap()).unwrap_err()["code"], "EACCES");
        fs::write(root.join("config.json"), json!({"backends":{"lark-cli":{"executable":other}}}).to_string()).unwrap();
        assert_eq!(state.executable(other.to_str().unwrap()).unwrap(), other);
        assert_eq!(state.executable("lark-cli").unwrap_err()["code"], "EACCES");
        assert_eq!(state.executable(bundled.to_str().unwrap()).unwrap_err()["code"], "EACCES");
        fs::remove_dir_all(root).unwrap();
    }
}
