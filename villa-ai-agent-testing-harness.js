(function(){

const $ = id => document.getElementById(id);

let controller = null;
let buffer = "";
let guestText = "";
let rawText = "";

function setStatus(t){
  $("statusText").textContent = t;
}

function clearAll(){
  guestText = "";
  rawText = "";
  buffer = "";
  $("guestOut").textContent = "(waiting...)";
  $("rawOut").textContent = "(no events yet)";
  $("metaGrid").innerHTML = "";
  $("ctaContainer").innerHTML = "";
  setStatus("Idle");
}

function appendGuest(t){
  guestText += t;
  $("guestOut").textContent = guestText;
}

function appendRaw(t){
  rawText += t;
  $("rawOut").textContent = rawText;
}

function renderMeta(meta){
  const grid = $("metaGrid");
  grid.innerHTML = "";

  Object.entries(meta).forEach(([k,v])=>{
    const card = document.createElement("div");
    card.className = "meta-card";
    card.innerHTML = `
      <div class="k">${k}</div>
      <div class="v">${JSON.stringify(v)}</div>
    `;
    grid.appendChild(card);
  });
}

function renderCTA(cta){
  const container = $("ctaContainer");
  const link = document.createElement("a");
  link.href = cta.url;
  link.target = "_blank";
  link.textContent = cta.label;
  container.appendChild(link);
}

function parseChunk(chunk){

  buffer += chunk;
  appendRaw(chunk);

  const parts = buffer.split("\n\n");
  buffer = parts.pop();

  parts.forEach(block=>{

    let eventName = "";
    let dataLines = [];

    block.split("\n").forEach(line=>{
      if(line.startsWith("event:")) eventName = line.slice(6).trim();
      if(line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    });

    if(!dataLines.length) return;

    let obj;
    try{
      obj = JSON.parse(dataLines.join("\n"));
    }catch{
      return;
    }

    if(eventName === "start"){
      setStatus("Streaming...");
    }

    if(eventName === "token" && obj.text){
      appendGuest(obj.text);
    }

    if(eventName === "cta"){
      renderCTA(obj);
    }

    if(eventName === "meta"){
      renderMeta(obj);
    }

    if(eventName === "done"){
      setStatus("Done");
    }

  });
}

async function run(){

  clearAll();

  const endpoint = $("endpoint").value.trim();
  const question = $("q").value.trim();

  if(!endpoint || !question){
    setStatus("Missing input");
    return;
  }

  controller = new AbortController();

  setStatus("Connecting...");

  try{

    const res = await fetch(endpoint,{
      method:"POST",
      headers:{ "content-type":"application/json" },
      body:JSON.stringify({ question }),
      signal:controller.signal
    });

    if(!res.ok){
      setStatus("HTTP " + res.status);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while(true){
      const {value, done} = await reader.read();
      if(done) break;
      parseChunk(decoder.decode(value,{stream:true}));
    }

  }catch(e){
    if(e.name === "AbortError"){
      setStatus("Stopped");
    }else{
      setStatus("Fetch error");
    }
  }
}

function stop(){
  if(controller) controller.abort();
}

$("runBtn").onclick = run;
$("stopBtn").onclick = stop;
$("clearBtn").onclick = clearAll;

document.querySelector(".collapsible").addEventListener("click", ()=>{
  const raw = document.getElementById("rawOut");
  raw.classList.toggle("collapsed");
});

})();