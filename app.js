import { firebaseConfig, SHARED_PASSWORD } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInAnonymously, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDocs, setDoc, updateDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const CLIENTES_COL = "clientes";
const REMEMBER_KEY = "bazaar_clientes_ok";
let CLIENTES = [];
let currentClient = null;
let currentFilter = 'todas';
let currentProblemaFilter = false;
let currentSaiuFilter = false;
let currentSearch = '';
let currentObsTag = 'nota';

// ---------------------------------------------------------------
// AUTH: senha compartilhada + sessão anônima no Firebase
// ---------------------------------------------------------------
function show(id){
  ['loading-screen','login-screen','app-root'].forEach(x=>{
    document.getElementById(x).style.display = (x===id) ? (id==='app-root' ? 'block' : 'flex') : 'none';
  });
}

document.getElementById('password-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const val = document.getElementById('password-input').value;
  const errEl = document.getElementById('password-error');
  if(val !== SHARED_PASSWORD){
    errEl.style.display = 'block';
    return;
  }
  errEl.style.display = 'none';
  localStorage.setItem(REMEMBER_KEY, '1');
  show('loading-screen');
  try{
    await signInAnonymously(auth);
  }catch(err){
    alert('Erro ao entrar: ' + err.message);
    show('login-screen');
  }
});
document.getElementById('logout-btn').addEventListener('click', ()=>{
  localStorage.removeItem(REMEMBER_KEY);
  signOut(auth);
});

onAuthStateChanged(auth, async (user)=>{
  if(!user){
    show('login-screen');
    return;
  }
  // usuário anônimo autenticado com sucesso (senha já foi validada antes de chegar aqui)
  show('loading-screen');
  await loadClientes();
  show('app-root');
  updateHeaderStats();
  renderGrid();
});

// se o navegador já tiver acesso liberado antes, tenta entrar direto sem pedir senha de novo
if(localStorage.getItem(REMEMBER_KEY) === '1'){
  show('loading-screen');
  signInAnonymously(auth).catch(()=> show('login-screen'));
} else {
  show('login-screen');
}

// ---------------------------------------------------------------
// FIRESTORE: carregar clientes
// ---------------------------------------------------------------
async function loadClientes(){
  const snap = await getDocs(collection(db, CLIENTES_COL));
  CLIENTES = [];
  snap.forEach(d=> CLIENTES.push(d.data()));
  CLIENTES.sort((a,b)=> (a.nome||'').localeCompare(b.nome||'', 'pt-BR'));
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
function money(v){ return (v||0).toLocaleString('pt-BR', {style:'currency', currency:'BRL'}); }
function initials(name){
  const parts = (name||'').trim().split(/\s+/).filter(Boolean);
  if(parts.length===0) return '?';
  if(parts.length===1) return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0]+parts[parts.length-1][0]).toUpperCase();
}
function statusBadgeClass(s){
  s=(s||'').toUpperCase();
  if(s==='ATIVA') return 'ativa';
  if(s==='INATIVA') return 'inativa';
  if(s==='PROBLEMA') return 'problema';
  return 'neutro';
}
function statusLabel(s){ if(!s || s.trim()==='') return 'Sem status'; return s.trim(); }
function phoneDigits(tel){
  if(!tel) return '';
  let d = tel.replace(/\D/g,'');
  if(d.length<=11) d = '55'+d;
  return d;
}
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2200);
}
function field(label, value){
  const empty = !value || value.toString().trim()==='';
  return `<div class="field"><label>${label}</label><div class="val ${empty?'empty-val':''}">${empty?'Não informado':value}</div></div>`;
}
function fieldFull(label, value){
  const empty = !value || value.toString().trim()==='';
  return `<div class="field full"><label>${label}</label><div class="val ${empty?'empty-val':''}">${empty?'Não informado':value}</div></div>`;
}

// ---------------------------------------------------------------
// Render: lista
// ---------------------------------------------------------------
function renderGrid(){
  const grid = document.getElementById('grid');
  const term = currentSearch.trim().toLowerCase();
  let list = CLIENTES.filter(c=>{
    if(currentFilter!=='todas' && (c.status||'').toUpperCase()!==currentFilter) return false;
    if(currentProblemaFilter && (c.qtd_problemas||0)===0) return false;
    if(currentSaiuFilter && !c.data_saida) return false;
    if(term){
      const hay = ((c.nome||'')+' '+(c.bairro||'')+' '+(c.telefone||'')+' '+(c.email||'')+' '+(c.cpf||'')).toLowerCase();
      if(!hay.includes(term)) return false;
    }
    return true;
  });

  document.getElementById('count-label').innerHTML = `Mostrando <b>${list.length}</b> de ${CLIENTES.length} clientes`;

  if(list.length===0){
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1;">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <div>Nenhuma cliente encontrada com esses filtros.</div>
    </div>`;
    return;
  }

  grid.innerHTML = list.map(c=>{
    const badgeCls = statusBadgeClass(c.status);
    const ultima = c.ultima_compra
      ? `<div class="sept-pill">🛍️ Última: ${c.ultima_compra}</div>`
      : `<div class="sept-pill zero">Sem compras registradas</div>`;
    const warn = (c.qtd_problemas||0)>0 ? `<span title="${c.qtd_problemas} registro(s) de problema" style="margin-left:6px;">⚠️</span>` : '';
    return `<div class="card" data-id="${c.id}">
      <div class="card-top">
        <div style="display:flex; gap:10px; align-items:center; min-width:0;">
          <div class="avatar">${initials(c.nome)}</div>
          <div style="min-width:0;">
            <div class="card-name">${c.nome}${warn}</div>
            <div class="card-sub">${c.bairro || 'Bairro não informado'}${c.cidade ? ' · '+c.cidade : ''}</div>
          </div>
        </div>
        <span class="badge ${badgeCls}">${statusLabel(c.status)}</span>
      </div>
      <div class="card-foot">
        ${ultima}
        ${c.total_gasto>0 ? `<span class="card-value">${money(c.total_gasto)}</span>` : ''}
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.card').forEach(el=> el.addEventListener('click', ()=> openPanel(el.dataset.id)));
}

function updateHeaderStats(){
  document.getElementById('stat-total').textContent = CLIENTES.length.toLocaleString('pt-BR');
  const ativas = CLIENTES.filter(c=>(c.status||'').toUpperCase()==='ATIVA');
  document.getElementById('stat-ativas').textContent = ativas.length.toLocaleString('pt-BR');
  const totalValor = CLIENTES.reduce((s,c)=>s+(c.total_gasto||0),0);
  document.getElementById('stat-valor').textContent = money(totalValor);
}

// ---------------------------------------------------------------
// Render: painel
// ---------------------------------------------------------------
function openPanel(id){
  const c = CLIENTES.find(x=>x.id===id);
  if(!c) return;
  currentClient = c;

  document.getElementById('p-monogram').textContent = initials(c.nome);
  document.getElementById('p-name').textContent = c.nome;
  document.getElementById('p-badge').textContent = statusLabel(c.status) + (c.data_saida ? ` · saiu em ${c.data_saida}` : '');
  document.getElementById('p-id').textContent = 'ID '+c.id;

  const wpp = document.getElementById('p-wpp');
  const digits = phoneDigits(c.telefone);
  if(digits){ wpp.href = `https://wa.me/${digits}`; wpp.style.display='flex'; } else { wpp.style.display='none'; }
  const mailBtn = document.getElementById('p-mail');
  if(c.email){ mailBtn.href = `mailto:${c.email}`; mailBtn.style.display='flex'; } else { mailBtn.style.display='none'; }

  renderDadosTab(c);
  renderHistoricoTab(c);
  renderObsTab(c);
  document.getElementById('tab-count-hist').textContent = c.qtd_compras||0;

  switchTab('dados');
  document.getElementById('panel').classList.add('show');
  document.getElementById('scrim').classList.add('show');
}
function closePanel(){
  document.getElementById('panel').classList.remove('show');
  document.getElementById('scrim').classList.remove('show');
}
document.getElementById('close-btn').addEventListener('click', closePanel);
document.getElementById('scrim').addEventListener('click', closePanel);
document.addEventListener('keydown', e=>{ if(e.key==='Escape') closePanel(); });

function switchTab(name){
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===name));
  document.querySelectorAll('.tab-content').forEach(t=>t.classList.toggle('active', t.id==='tab-'+name));
}
document.querySelectorAll('.tab').forEach(t=> t.addEventListener('click', ()=> switchTab(t.dataset.tab)));

function renderDadosTab(c){
  const el = document.getElementById('tab-dados');
  el.innerHTML = `
    <div class="section-title">Ciclo de vida</div>
    <div class="field-grid">
      ${field('Entrou no grupo', c.data_entrada)}
      ${field('Saiu do grupo', c.data_saida)}
      ${field('CPF', c.cpf)}
      ${field('Total gasto no histórico', c.total_gasto>0 ? money(c.total_gasto) : '')}
    </div>
    <div class="section-title">Contato</div>
    <div class="field-grid">
      ${field('Telefone', c.telefone)}
      ${field('E-mail', c.email)}
      ${field('Rede social', c.rede_social)}
      ${field('Bairro', c.bairro)}
    </div>
    <div class="section-title">Endereço de entrega</div>
    <div class="field-grid">
      ${fieldFull('Endereço', c.endereco)}
      ${field('Complemento', c.complemento)}
      ${field('CEP', c.cep)}
      ${field('Cidade', c.cidade)}
      ${field('Valor da entrega', c.valor_entrega)}
      ${field('Tipo de entrega', c.entrega_tipo)}
      ${field('Período preferido', c.periodo_entrega)}
    </div>
    <div class="section-title">Perfil</div>
    <div class="field-grid">
      ${field('Data de nascimento', c.nascimento)}
      ${field('Idade', c.idade!=null ? c.idade+' anos' : '')}
      ${field('Profissão', c.profissao)}
      ${field('Meio / Grupo', c.meio)}
    </div>
    <div class="section-title">Origem</div>
    <div class="field-grid">
      ${field('Como conheceu a loja', c.como_conheceu)}
      ${field('Indicada por', c.indicada_por)}
      ${fieldFull('Entrou no grupo (texto original)', c.entrou_grupo_texto)}
    </div>
  `;
}

function renderHistoricoTab(c){
  const el = document.getElementById('tab-historico');
  if(!c.qtd_compras){
    el.innerHTML = `<div class="empty-tab">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
      <div>Nenhuma compra registrada para essa cliente.</div>
    </div>`;
    return;
  }
  const meses = (c.historico_meses||[]).slice().reverse();
  el.innerHTML = `
    <div class="summary-strip">
      <div class="sum-card"><b>${money(c.total_gasto)}</b><span>Total no histórico</span></div>
      <div class="sum-card"><b>${c.qtd_compras}</b><span>Itens comprados</span></div>
      <div class="sum-card"><b>${c.ultima_compra || '—'}</b><span>Compra mais recente</span></div>
    </div>
    ${meses.map(m=>`
      <div class="month-group">
        <div class="month-label">🗓️ ${m.l} <span style="margin-left:auto; color:var(--wine-dark); font-weight:700;">${money(m.sub)}</span></div>
        ${m.it.slice().reverse().map(p=>`
          <div class="purchase-item">
            <div class="pi-left">
              <div class="pi-name">${p.i}</div>
              <div class="pi-meta">
                ${p.cat ? `<span>${p.cat}</span>` : ''}
                ${p.mc ? `<span>${p.mc}</span>` : ''}
                ${p.vd ? `<span>${p.vd}</span>` : ''}
              </div>
            </div>
            <div class="pi-value">${money(p.v)}</div>
          </div>
        `).join('')}
      </div>
    `).join('')}
  `;
}

function sucessoBadges(e){
  const b = [];
  if(e.pagamento) b.push({t:e.pagamento, bad: e.pagamento!=='Em dia'});
  if(e.entrega) b.push({t:e.entrega, bad: e.entrega!=='Em dia'});
  if(e.tratativa) b.push({t:e.tratativa, bad: e.tratativa==='Rude'});
  if(e.compras) b.push({t:e.compras, bad: /saiu|retirada/i.test(e.compras)});
  return b;
}
function renderSucessoHistorico(c){
  const hist = c.sucesso_historico || [];
  if(hist.length===0) return `<div class="empty-tab" style="padding:24px 10px;">Nenhum registro de acompanhamento mensal para essa cliente.</div>`;
  return hist.slice().reverse().map(e=>{
    const isProblem = !!(e.problemas_internos) || sucessoBadges(e).some(b=>b.bad);
    return `<div class="obs-item ${isProblem?'problema':'nota'}">
      <div class="obs-item-head">
        <span class="obs-item-tag ${isProblem?'problema':'nota'}">${e.mes}/${e.ano}${e.atendente?' · '+e.atendente:''}</span>
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:5px; margin:5px 0;">
        ${sucessoBadges(e).map(b=>`<span class="badge ${b.bad?'problema':'ativa'}" style="font-size:9.5px;">${b.t}</span>`).join('')}
        ${e.problemas_internos ? `<span class="badge problema" style="font-size:9.5px;">⚠ ${e.problemas_internos}</span>` : ''}
      </div>
      ${e.observacoes ? `<div class="obs-item-text">${e.observacoes}</div>` : ''}
    </div>`;
  }).join('');
}

async function renderObsTab(c){
  const el = document.getElementById('tab-obs');
  el.innerHTML = `
    <div class="section-title">Histórico de Sucesso do Cliente</div>
    <div id="sucesso-hist">${renderSucessoHistorico(c)}</div>
    <div class="section-title">Novas observações da equipe</div>
    <div class="obs-form">
      <textarea id="obs-text" placeholder="Escreva uma observação sobre essa cliente (ex: atrasou pagamento, pediu troca, preferências de tamanho...)"></textarea>
      <div class="obs-form-row">
        <div class="obs-tag-select">
          <div class="tag-opt" data-tag="nota">📝 Nota</div>
          <div class="tag-opt" data-tag="problema">⚠️ Problema</div>
        </div>
        <button class="save-btn" id="obs-save">Salvar observação</button>
      </div>
    </div>
    <div id="obs-list">Carregando observações...</div>
  `;

  const tagOpts = el.querySelectorAll('.tag-opt');
  currentObsTag = 'nota';
  tagOpts.forEach(t=>t.classList.toggle('active', t.dataset.tag===currentObsTag));
  tagOpts.forEach(t=>t.addEventListener('click', ()=>{
    currentObsTag = t.dataset.tag;
    tagOpts.forEach(x=>x.classList.toggle('active', x.dataset.tag===currentObsTag));
  }));

  document.getElementById('obs-save').addEventListener('click', async ()=>{
    const ta = document.getElementById('obs-text');
    const text = ta.value.trim();
    if(!text) return;
    const btn = document.getElementById('obs-save');
    btn.disabled = true; btn.textContent = 'Salvando...';
    const list = (c.observacoes_equipe || []).slice();
    list.push({ text, tag: currentObsTag, date: new Date().toLocaleString('pt-BR') });
    try{
      await updateDoc(doc(db, CLIENTES_COL, c.id), { observacoes_equipe: list });
      c.observacoes_equipe = list;
      ta.value = '';
      showToast('Observação salva');
      renderObsList(c);
    }catch(e){
      showToast('Erro ao salvar: '+e.message);
    }
    btn.disabled = false; btn.textContent = 'Salvar observação';
  });

  renderObsList(c);
}

function renderObsList(c){
  const list = c.observacoes_equipe || [];
  const total = (c.sucesso_historico||[]).length + list.length;
  document.getElementById('tab-count-obs').textContent = total;
  const listEl = document.getElementById('obs-list');
  if(list.length===0){
    listEl.innerHTML = `<div class="empty-tab" style="padding:20px 10px;">Nenhuma observação manual registrada ainda.</div>`;
    return;
  }
  listEl.innerHTML = list.slice().reverse().map((o, revIdx)=>{
    const idx = list.length-1-revIdx;
    return `<div class="obs-item ${o.tag}">
      <div class="obs-item-head">
        <span class="obs-item-tag ${o.tag}">${o.tag==='problema'?'Problema':'Nota'}</span>
        <span class="obs-item-date">${o.date}${o.by?' · '+o.by:''}</span>
      </div>
      <div class="obs-item-text">${o.text}</div>
      <span class="obs-item-del" data-idx="${idx}">Excluir</span>
    </div>`;
  }).join('');
  listEl.querySelectorAll('.obs-item-del').forEach(d=>{
    d.addEventListener('click', async ()=>{
      const idx = parseInt(d.dataset.idx);
      const newList = (c.observacoes_equipe||[]).slice();
      newList.splice(idx,1);
      try{
        await updateDoc(doc(db, CLIENTES_COL, c.id), { observacoes_equipe: newList });
        c.observacoes_equipe = newList;
        showToast('Observação removida');
        renderObsList(c);
      }catch(e){ showToast('Erro ao remover: '+e.message); }
    });
  });
}

// ---------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------
document.getElementById('search').addEventListener('input', e=>{ currentSearch = e.target.value; renderGrid(); });
document.querySelectorAll('#status-chips .chip').forEach(chip=>{
  chip.addEventListener('click', ()=>{
    document.querySelectorAll('#status-chips .chip').forEach(c=>c.classList.remove('active'));
    chip.classList.add('active');
    currentFilter = chip.dataset.status;
    renderGrid();
  });
});
document.getElementById('chip-problemas').addEventListener('click', function(){
  currentProblemaFilter = !currentProblemaFilter; this.classList.toggle('active'); renderGrid();
});
document.getElementById('chip-saiu').addEventListener('click', function(){
  currentSaiuFilter = !currentSaiuFilter; this.classList.toggle('active'); renderGrid();
});

// =================================================================
// IMPORTAÇÃO DE PLANILHA (Cliente / Vendas / Sucesso do cliente)
// =================================================================
const MES_NUM = {'JANEIRO':1,'FEVEREIRO':2,'MARÇO':3,'MARCO':3,'ABRIL':4,'MAIO':5,'JUNHO':6,'JULHO':7,
                 'AGOSTO':8,'SETEMBRO':9,'OUTUBRO':10,'NOVEMBRO':11,'DEZEMBRO':12};
const MES_CAP = {1:'Janeiro',2:'Fevereiro',3:'Março',4:'Abril',5:'Maio',6:'Junho',7:'Julho',8:'Agosto',9:'Setembro',10:'Outubro',11:'Novembro',12:'Dezembro'};
const VALID_CONF = ['OK','BR','ONLINE','EST','ENT'];

function normStr(v){ return (v===null||v===undefined) ? '' : String(v).trim(); }
function normConf(v){
  if(!v) return '';
  return String(v).trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}
function fmtDate(v){
  if(v instanceof Date && !isNaN(v)) {
    const dd=String(v.getDate()).padStart(2,'0'), mm=String(v.getMonth()+1).padStart(2,'0'), yy=v.getFullYear();
    return `${dd}/${mm}/${yy}`;
  }
  return normStr(v);
}
function toIntOrNull(v){
  if(v===null||v===undefined||v==='') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : Math.round(n);
}

function parseClienteSheet(rows){
  const customers = {};
  for(let r=1;r<rows.length;r++){
    const row = rows[r]; if(!row) continue;
    const cidRaw = row[1];
    const nome = normStr(row[3]);
    if(cidRaw===undefined || cidRaw===null || cidRaw==='' || !nome) continue;
    const cid = String(toIntOrNull(cidRaw) ?? cidRaw).trim();
    const nasc = fmtDate(row[7]);
    const idadeRaw = row[9];
    customers[cid] = {
      id: cid, nome,
      status_original: normStr(row[4]),
      meio: normStr(row[5]),
      cpf: normStr(row[6]),
      nascimento: nasc,
      idade: (typeof idadeRaw==='number') ? idadeRaw : null,
      telefone: normStr(row[10]),
      bairro: normStr(row[11]) || normStr(row[16]),
      valor_entrega: normStr(row[12]),
      cidade: normStr(row[13]),
      email: normStr(row[14]),
      endereco: normStr(row[15]),
      cep: normStr(row[17]),
      complemento: normStr(row[18]),
      entrega_tipo: normStr(row[19]),
      periodo_entrega: normStr(row[20]),
      rede_social: normStr(row[21]),
      profissao: normStr(row[22]),
      como_conheceu: normStr(row[23]),
      indicada_por: normStr(row[24]),
      entrou_grupo_texto: normStr(row[25]),
      data_entrada: fmtDate(row[2]),
      valor_planilha: (typeof row[0]==='number') ? row[0] : null
    };
  }
  return customers;
}

function parseSucessoSheet(rows){
  const sucesso = {};
  for(let r=1;r<rows.length;r++){
    const row = rows[r]; if(!row) continue;
    const cod = row[0];
    if(cod===undefined||cod===null||cod==='') continue;
    const cid = String(toIntOrNull(cod));
    if(cid==='null') continue;
    const mes = normStr(row[2]).toUpperCase();
    const ano = toIntOrNull(row[3]);
    if(!mes || !ano) continue;
    const mesN = MES_NUM[mes] || 0;
    const entry = {
      mes: MES_CAP[mesN] || mes, ano, sort_key: ano*100+mesN,
      atendente: normStr(row[4]), pagamento: normStr(row[5]), compras: normStr(row[6]),
      entrega: normStr(row[7]), tratativa: normStr(row[8]), problemas_internos: normStr(row[9]),
      observacoes: normStr(row[10]), valor: (typeof row[11]==='number') ? row[11] : 0, ranking: row[12]
    };
    (sucesso[cid] = sucesso[cid] || []).push(entry);
  }
  Object.values(sucesso).forEach(arr=> arr.sort((a,b)=>a.sort_key-b.sort_key));
  return sucesso;
}

function parseVendasSheet(rows){
  const vendas = {};
  for(let r=1;r<rows.length;r++){
    const row = rows[r]; if(!row) continue;
    const ano = toIntOrNull(row[0]);
    const mes = normStr(row[1]).toUpperCase();
    const cod = row[3];
    const item = row[5];
    const conf = normConf(row[8]);
    if(!VALID_CONF.some(v=>conf.startsWith(v))) continue;
    if(cod===undefined||cod===null||cod===''||!item||!ano||!mes) continue;
    const valor = (typeof row[6]==='number') ? row[6] : 0;
    if(!valor || valor<=0) continue; // item com valor zerado = não conseguimos importar (NOK) — não conta como compra
    const cid = String(toIntOrNull(cod));
    const mesN = MES_NUM[mes] || 0;
    (vendas[cid] = vendas[cid] || []).push({
      ano, mes: MES_CAP[mesN]||mes, sort_key: ano*100+mesN,
      item: normStr(item), valor, marca: normStr(row[4]), vendedora: normStr(row[9]), categoria: normStr(row[10])
    });
  }
  return vendas;
}

const EXIT_LABELS = ['SAIU DO GRUPO','RETIRADA DO GRUPO'];
const ACTIVE_LABEL = 'ATIVA QUE COMPRA';

function buildFinalClients(customers, sucesso, vendas){
  const out = [];
  for(const cid in customers){
    const cust = Object.assign({}, customers[cid]);
    const items = (vendas[cid]||[]).slice().sort((a,b)=>a.sort_key-b.sort_key);
    const monthMap = {};
    for(const it of items){
      const label = `${it.mes}/${it.ano}`;
      if(!monthMap[label]) monthMap[label] = {l:label, sk:it.sort_key, it:[], sub:0};
      monthMap[label].it.push({i:it.item, v:Math.round(it.valor*100)/100, mc:it.marca, cat:it.categoria, vd:it.vendedora});
      monthMap[label].sub += it.valor;
    }
    const meses = Object.values(monthMap).sort((a,b)=>a.sk-b.sk);
    meses.forEach(m=> m.sub = Math.round(m.sub*100)/100);
    const totalGasto = Math.round(meses.reduce((s,m)=>s+m.sub,0)*100)/100;
    const ultimaCompra = items.length ? `${items[items.length-1].mes}/${items[items.length-1].ano}` : '';

    const hist = sucesso[cid] || [];
    let statusFinal = (cust.status_original||'').trim();
    let dataSaida = '';
    if(hist.length){
      const latest = hist[hist.length-1];
      const comprasLatest = latest.compras.trim().toUpperCase();
      if(EXIT_LABELS.includes(comprasLatest)){ statusFinal='INATIVA'; dataSaida = `${latest.mes}/${latest.ano}`; }
      else if(comprasLatest===ACTIVE_LABEL){ statusFinal='ATIVA'; }
      for(const e of hist){
        if(EXIT_LABELS.includes(e.compras.trim().toUpperCase())){ dataSaida = dataSaida || `${e.mes}/${e.ano}`; break; }
      }
    }
    if(!statusFinal) statusFinal = items.length>0 ? 'ATIVA' : '';

    const problemas = hist.filter(e=> e.problemas_internos ||
      (e.pagamento && e.pagamento!=='Em dia') || (e.tratativa==='Rude') ||
      (e.entrega && !['Em dia',''].includes(e.entrega)));

    delete cust.status_original;
    cust.status = statusFinal;
    cust.data_saida = dataSaida;
    cust.historico_meses = meses;
    cust.total_gasto = totalGasto;
    cust.qtd_compras = items.length;
    cust.ultima_compra = ultimaCompra;
    cust.sucesso_historico = hist;
    cust.qtd_problemas = problemas.length;

    out.push(cust);
  }
  return out;
}

async function writeClientsToFirestore(clients, onProgress){
  const CHUNK = 400;
  let done = 0;
  for(let i=0;i<clients.length;i+=CHUNK){
    const batch = writeBatch(db);
    const slice = clients.slice(i, i+CHUNK);
    for(const c of slice){
      const ref = doc(db, CLIENTES_COL, c.id);
      // merge:true preserva o campo observacoes_equipe já existente, que não é reenviado aqui
      batch.set(ref, c, { merge: true });
    }
    await batch.commit();
    done += slice.length;
    onProgress(done, clients.length);
  }
}

function readWorkbook(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = (e)=>{
      try{
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, {type:'array', cellDates:true});
        resolve(wb);
      }catch(err){ reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

async function handleImportFile(file){
  const progressEl = document.getElementById('import-progress');
  const statusEl = document.getElementById('import-status');
  const fillEl = document.getElementById('progress-fill');
  progressEl.classList.add('show');
  statusEl.textContent = 'Lendo planilha...';
  fillEl.style.width = '8%';

  try{
    const wb = await readWorkbook(file);
    const need = ['Cliente','Vendas','Sucesso do cliente'];
    for(const n of need){
      if(!wb.SheetNames.includes(n)) throw new Error(`Aba "${n}" não encontrada na planilha.`);
    }
    statusEl.textContent = 'Processando aba Cliente...';
    fillEl.style.width = '25%';
    const clienteRows = XLSX.utils.sheet_to_json(wb.Sheets['Cliente'], {header:1, raw:true, defval:null});
    const customers = parseClienteSheet(clienteRows);

    statusEl.textContent = 'Processando aba Sucesso do cliente...';
    fillEl.style.width = '45%';
    const sucessoRows = XLSX.utils.sheet_to_json(wb.Sheets['Sucesso do cliente'], {header:1, raw:true, defval:null});
    const sucesso = parseSucessoSheet(sucessoRows);

    statusEl.textContent = 'Processando aba Vendas (pode levar um instante)...';
    fillEl.style.width = '60%';
    const vendasRows = XLSX.utils.sheet_to_json(wb.Sheets['Vendas'], {header:1, raw:true, defval:null});
    const vendas = parseVendasSheet(vendasRows);

    statusEl.textContent = 'Montando os dados finais...';
    fillEl.style.width = '75%';
    const finalClients = buildFinalClients(customers, sucesso, vendas);

    statusEl.textContent = `Salvando ${finalClients.length} clientes no banco de dados...`;
    await writeClientsToFirestore(finalClients, (done,total)=>{
      fillEl.style.width = (75 + (done/total)*25) + '%';
      statusEl.textContent = `Salvando... ${done}/${total} clientes`;
    });

    statusEl.textContent = 'Concluído! Recarregando...';
    await loadClientes();
    updateHeaderStats();
    renderGrid();
    showToast(`Importação concluída: ${finalClients.length} clientes atualizados`);
    setTimeout(()=>{ document.getElementById('import-modal').classList.remove('show'); progressEl.classList.remove('show'); }, 1200);
  }catch(err){
    statusEl.textContent = 'Erro: ' + err.message;
    fillEl.style.width = '0%';
    showToast('Erro na importação: ' + err.message);
  }
}

document.getElementById('open-import').addEventListener('click', ()=> document.getElementById('import-modal').classList.add('show'));
document.getElementById('close-import').addEventListener('click', ()=> document.getElementById('import-modal').classList.remove('show'));
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
dropZone.addEventListener('click', ()=> fileInput.click());
fileInput.addEventListener('change', (e)=>{ if(e.target.files[0]) handleImportFile(e.target.files[0]); });
dropZone.addEventListener('dragover', (e)=>{ e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', ()=> dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e)=>{
  e.preventDefault(); dropZone.classList.remove('dragover');
  if(e.dataTransfer.files[0]) handleImportFile(e.dataTransfer.files[0]);
});
