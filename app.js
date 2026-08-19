import { firebaseConfig, SHARED_PASSWORD } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInAnonymously, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch
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
function statusLabel(s){ if(!s || s.trim()==='') return 'Nunca comprou'; return s.trim(); }
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
      const hayDigits = ((c.telefone||'')+' '+(c.cpf||'')).replace(/\D/g,'');
      const termDigits = term.replace(/\D/g,'');
      const matchesText = hay.includes(term);
      const matchesDigits = termDigits.length>=4 && hayDigits.includes(termDigits);
      if(!matchesText && !matchesDigits) return false;
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
  const ativas = CLIENTES.filter(c=>(c.status||'').toUpperCase()==='ATIVA');
  document.getElementById('stat-total').textContent = ativas.length.toLocaleString('pt-BR');
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
  renderPerfilTab(c);
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

function extractSize(itemText){
  const m = itemText.match(/tam\.?\s*([A-Za0-9]+(?:\/[A-Za0-9]+)?)/i);
  return m ? m[1].toUpperCase() : null;
}

function computePurchaseProfile(c){
  const allItems = [];
  (c.historico_meses||[]).forEach(m=> m.it.forEach(p=> allItems.push(p)));

  // itens recomprados (mesmo nome aparecendo 2+ vezes)
  const itemCount = {};
  allItems.forEach(p=>{
    const key = p.i;
    if(!itemCount[key]) itemCount[key] = {nome:p.i, count:0, total:0};
    itemCount[key].count++;
    itemCount[key].total += p.v;
  });
  const recomprados = Object.values(itemCount).filter(x=>x.count>1).sort((a,b)=>b.count-a.count);

  // categoria mais comprada
  const catCount = {};
  allItems.forEach(p=>{ if(p.cat){ catCount[p.cat] = (catCount[p.cat]||0)+1; } });
  const catTop = Object.entries(catCount).sort((a,b)=>b[1]-a[1])[0];

  // tamanho mais comprado
  const sizeCount = {};
  allItems.forEach(p=>{
    const s = extractSize(p.i);
    if(s){ sizeCount[s] = (sizeCount[s]||0)+1; }
  });
  const sizeTop = Object.entries(sizeCount).sort((a,b)=>b[1]-a[1])[0];

  return { recomprados, catTop, sizeTop, totalItens: allItems.length };
}

function renderPerfilTab(c){
  const el = document.getElementById('tab-perfil');
  const p = computePurchaseProfile(c);
  document.getElementById('tab-count-perfil').textContent = p.recomprados.length || '·';
  if(p.totalItens===0){
    el.innerHTML = `<div class="empty-tab">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/></svg>
      <div>Sem compras suficientes pra montar um perfil ainda.</div>
    </div>`;
    return;
  }
  el.innerHTML = `
    <div class="section-title">Preferências</div>
    <div class="field-grid" style="margin-bottom:22px;">
      ${field('Categoria que mais compra', p.catTop ? `${p.catTop[0]} (${p.catTop[1]}x)` : '')}
      ${field('Tamanho que mais compra', p.sizeTop ? `${p.sizeTop[0]} (${p.sizeTop[1]}x)` : '')}
    </div>
    <div class="section-title">Itens que recomprou</div>
    ${p.recomprados.length ? p.recomprados.map(r=>`
      <div class="purchase-item">
        <div class="pi-left">
          <div class="pi-name">${r.nome}</div>
          <div class="pi-meta"><span>Comprou ${r.count}x</span></div>
        </div>
        <div class="pi-value">${money(r.total)}</div>
      </div>
    `).join('') : `<div class="empty-tab" style="padding:20px 10px;">Nenhum item repetido até agora.</div>`}
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
    ${meses.map((m,idx)=>`
      <div class="month-accordion">
        <div class="month-header" data-idx="${idx}">
          <span class="month-chevron">▸</span>
          <span class="month-header-label">🗓️ ${m.l}</span>
          <span class="month-header-count">${m.it.length} ${m.it.length===1?'item':'itens'}</span>
          <span class="month-header-value">${money(m.sub)}</span>
        </div>
        <div class="month-items" id="month-items-${idx}" style="display:none;">
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
      </div>
    `).join('')}
  `;

  el.querySelectorAll('.month-header').forEach(h=>{
    h.addEventListener('click', ()=>{
      const idx = h.dataset.idx;
      const itemsEl = document.getElementById('month-items-'+idx);
      const chevron = h.querySelector('.month-chevron');
      const isOpen = itemsEl.style.display !== 'none';
      itemsEl.style.display = isOpen ? 'none' : 'block';
      chevron.textContent = isOpen ? '▸' : '▾';
      h.classList.toggle('open', !isOpen);
    });
  });
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
// NAVEGAÇÃO PRINCIPAL: Clientes / Relatório de Vendas
// =================================================================
let relatorioLoaded = false;
document.querySelectorAll('.main-nav-tab').forEach(t=>{
  t.addEventListener('click', ()=>{
    document.querySelectorAll('.main-nav-tab').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    const view = t.dataset.view;
    document.getElementById('view-clientes').style.display = (view==='clientes') ? 'block' : 'none';
    document.getElementById('view-relatorio').style.display = (view==='relatorio') ? 'block' : 'none';
    if(view==='relatorio' && !relatorioLoaded){
      relatorioLoaded = true;
      initRelatorio();
    }
  });
});

// =================================================================
// RELATÓRIO DE VENDAS
// =================================================================
let PERIODOS = [];       // [{sk, l}] ordenado do mais recente pro mais antigo
let currentPeriodoFilter = { type: 'all' };
let currentVendTab = 'geral';

function buildPeriodos(){
  const map = {};
  CLIENTES.forEach(c=> (c.historico_meses||[]).forEach(m=>{ map[m.sk] = m.l; }));
  PERIODOS = Object.entries(map).map(([sk,l])=>({sk:parseInt(sk), l})).sort((a,b)=>b.sk-a.sk);
}

function periodMatches(sk, filter){
  const ano = Math.floor(sk/100), mes = sk%100;
  if(filter.type==='all') return true;
  if(filter.type==='month') return sk===filter.sk;
  if(filter.type==='year') return ano===filter.ano;
  if(filter.type==='quarter') return ano===filter.ano && Math.ceil(mes/3)===filter.q;
  return false;
}

function normVendKey(v){ return (v||'').trim().toUpperCase(); }
function titleCaseName(v){
  return (v||'').trim().toLowerCase().split(/\s+/).map(w=> w ? w.charAt(0).toUpperCase()+w.slice(1) : w).join(' ');
}

function computeReport(filter){
  const catTotals = {};
  const marcaTotals = {};
  const productTotals = {};
  const vendedoraTotals = {};
  const clientRows = [];
  let totalValor = 0, totalQtd = 0;

  CLIENTES.forEach(c=>{
    let cValor=0, cQtd=0;
    const cCat = {}, cVend = {};
    (c.historico_meses||[]).forEach(m=>{
      if(!periodMatches(m.sk, filter)) return;
      m.it.forEach(p=>{
        totalValor += p.v; totalQtd++;
        cValor += p.v; cQtd++;
        if(p.cat){ catTotals[p.cat] = (catTotals[p.cat]||0)+p.v; cCat[p.cat] = (cCat[p.cat]||0)+1; }
        if(p.mc){ marcaTotals[p.mc] = marcaTotals[p.mc] || {valor:0,qtd:0}; marcaTotals[p.mc].valor += p.v; marcaTotals[p.mc].qtd++; }
        productTotals[p.i] = productTotals[p.i] || {valor:0,qtd:0}; productTotals[p.i].valor += p.v; productTotals[p.i].qtd++;
        if(p.vd){
          const vk = normVendKey(p.vd);
          vendedoraTotals[vk] = vendedoraTotals[vk] || {valor:0,qtd:0, display: titleCaseName(p.vd)};
          vendedoraTotals[vk].valor += p.v; vendedoraTotals[vk].qtd++;
          cVend[vk] = (cVend[vk]||0)+p.v;
        }
      });
    });
    if(cQtd>0){
      const catFavEntry = Object.entries(cCat).sort((a,b)=>b[1]-a[1])[0];
      const vendPrincEntry = Object.entries(cVend).sort((a,b)=>b[1]-a[1])[0];
      const vendPrincDisplay = vendPrincEntry ? (vendedoraTotals[vendPrincEntry[0]]?.display || vendPrincEntry[0]) : '';
      clientRows.push({
        id:c.id, nome:c.nome, valor:cValor, qtd:cQtd,
        catFav: catFavEntry ? catFavEntry[0] : '', vendPrincipal: vendPrincDisplay,
        perVendedora: cVend
      });
    }
  });

  return {
    totalValor, totalQtd,
    ticketMedio: totalQtd>0 ? totalValor/totalQtd : 0,
    clientesAtivos: clientRows.length,
    categorias: Object.entries(catTotals).sort((a,b)=>b[1]-a[1]),
    marcas: Object.entries(marcaTotals),
    produtos: Object.entries(productTotals),
    vendedoras: Object.entries(vendedoraTotals).sort((a,b)=>b[1].valor-a[1].valor),
    clientRows
  };
}

// Dados de dia/horário de venda — extraídos manualmente do relatório histórico.
// Só existem pra estes meses porque não temos data completa de venda na base atual.
const DIAS_HORARIOS_STATIC = {
  'Junho/2026': {
    periodoDia: [
      {p:'TARDE', valor:87726.14, pct:0.4283143212581755},
      {p:'MANHÃ', valor:73106.06, pct:0.3569332067814617},
      {p:'NOITE', valor:43985.00, pct:0.2147524719603627}
    ],
    topDias: [
      {data:'11/05', dia:'Seg', total:67873.5},
      {data:'12/05', dia:'Ter', total:38546.7},
      {data:'02/05', dia:'Sáb', total:33079.18},
      {data:'04/05', dia:'Seg', total:30833.6},
      {data:'13/05', dia:'Qua', total:30131.4},
      {data:'07/05', dia:'Qui', total:25372.0},
      {data:'01/05', dia:'Sex', total:24852.5},
      {data:'29/04', dia:'Qua', total:23339.6},
      {data:'06/05', dia:'Qua', total:21683.0},
      {data:'08/05', dia:'Sex', total:20631.32}
    ]
  },
  'Julho/2026': {
    periodoDia: [
      {p:'TARDE', valor:243396.94, pct:0.438978751610255},
      {p:'NOITE', valor:176634.00, pct:0.318568396184134},
      {p:'MANHÃ', valor:134430.84, pct:0.242452852205611}
    ],
    topDias: [
      {data:'23/06', dia:'Ter', total:28453.9},
      {data:'02/06', dia:'Ter', total:28302.46},
      {data:'07/06', dia:'Dom', total:26603.9},
      {data:'04/06', dia:'Qui', total:23933.6},
      {data:'26/06', dia:'Sex', total:23844.9},
      {data:'18/06', dia:'Qui', total:23685.34},
      {data:'21/06', dia:'Dom', total:23387.42},
      {data:'03/06', dia:'Qua', total:23015.6},
      {data:'25/06', dia:'Qui', total:22461.6},
      {data:'14/06', dia:'Dom', total:22379.6}
    ]
  }
};

function renderDiasHorariosSection(periodoLabel){
  const data = DIAS_HORARIOS_STATIC[periodoLabel];
  if(!data){
    return `
      <div class="rel-section">
        <div class="rel-section-title">Dias e horários que mais venderam</div>
        <div class="rel-panel"><div class="empty-tab" style="padding:14px 4px;">Sem dado de dia/horário pra esse período — essa informação só existe pra Junho e Julho de 2026 no momento.</div></div>
      </div>`;
  }
  const maxDia = data.topDias[0].total;
  return `
    <div class="rel-section">
      <div class="rel-section-title">Dias e horários que mais venderam</div>
      <div class="rel-grid-2">
        <div class="rel-panel">
          <h4>Top 10 dias que mais venderam</h4>
          ${data.topDias.map((d,i)=> relRow(i+1, `${d.data} (${d.dia})`, '', money(d.total), maxDia)).join('')}
        </div>
        <div class="rel-panel">
          <h4>Vendas por período do dia</h4>
          ${data.periodoDia.map((p,i)=> relRow(i+1, p.p, (p.pct*100).toFixed(0)+'%', money(p.valor), data.periodoDia[0].valor)).join('')}
        </div>
      </div>
    </div>
  `;
}

function computeClientProfile(){
  const bairroCount = {};
  CLIENTES.forEach(c=>{
    const b = (c.bairro||'').trim();
    if(b) bairroCount[b] = (bairroCount[b]||0)+1;
  });
  const bairros = Object.entries(bairroCount).sort((a,b)=>b[1]-a[1]);

  const faixas = [[0,19],[20,24],[25,29],[30,34],[35,39],[40,44],[45,49],[50,59],[60,150]];
  const faixaLabels = ['Até 19','20-24','25-29','30-34','35-39','40-44','45-49','50-59','60+'];
  const faixaCount = new Array(faixas.length).fill(0);
  let semIdade = 0;
  CLIENTES.forEach(c=>{
    if(typeof c.idade==='number' && c.idade>0 && c.idade<120){
      const idx = faixas.findIndex(([lo,hi])=> c.idade>=lo && c.idade<=hi);
      if(idx>=0) faixaCount[idx]++;
    } else {
      semIdade++;
    }
  });

  const last6 = PERIODOS.slice(0,6);
  let compraTodoMesList = [], gastaMilTodoMesList = [];
  if(last6.length===6){
    CLIENTES.forEach(c=>{
      const mesesMap = {};
      (c.historico_meses||[]).forEach(m=> mesesMap[m.sk]=m);
      const totalPeriodo = last6.reduce((s,p)=> s + (mesesMap[p.sk]?.sub||0), 0);
      if(last6.every(p=> mesesMap[p.sk] && mesesMap[p.sk].it.length>0)){
        compraTodoMesList.push({id:c.id, nome:c.nome, valor:totalPeriodo});
      }
      if(last6.every(p=> mesesMap[p.sk] && mesesMap[p.sk].sub>1000)){
        gastaMilTodoMesList.push({id:c.id, nome:c.nome, valor:totalPeriodo});
      }
    });
    compraTodoMesList.sort((a,b)=>b.valor-a.valor);
    gastaMilTodoMesList.sort((a,b)=>b.valor-a.valor);
  }

  return { bairros, faixaLabels, faixaCount, semIdade, last6, compraTodoMesList, gastaMilTodoMesList };
}

function relListToggle(id, title, list){
  if(!list.length) return '';
  return `
    <div style="margin-top:8px;">
      <span class="obs-item-del" style="color:var(--wine-dark); font-weight:600;" id="toggle-${id}">Ver lista (${list.length}) ▾</span>
      <div id="list-${id}" style="display:none; margin-top:10px; max-height:280px; overflow-y:auto;">
        ${list.map((c,i)=>`
          <div class="purchase-item">
            <div class="pi-left"><div class="pi-name">${i+1}. ${c.nome}</div></div>
            <div class="pi-value">${money(c.valor)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderPerfilBaseSection(){
  const p = computeClientProfile();
  const maxBairro = p.bairros.length ? p.bairros[0][1] : 0;
  const maxFaixa = Math.max(...p.faixaCount, 1);
  const periodoLabel6 = p.last6.length===6 ? `${p.last6[5].l} até ${p.last6[0].l}` : '';

  return `
    <div class="rel-section">
      <div class="rel-section-title">Perfil da Base de Clientes</div>

      <div class="rel-grid-2" style="margin-bottom:16px;">
        <div class="rel-panel">
          <b style="font-family:'Fraunces',serif; font-size:22px; color:var(--wine-dark);">${p.compraTodoMesList.length.toLocaleString('pt-BR')}</b>
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-soft);">Compraram todo mês${periodoLabel6 ? ` (${periodoLabel6})` : ''}</div>
          ${relListToggle('compra-mes', 'Compraram todo mês', p.compraTodoMesList)}
        </div>
        <div class="rel-panel">
          <b style="font-family:'Fraunces',serif; font-size:22px; color:var(--wine-dark);">${p.gastaMilTodoMesList.length.toLocaleString('pt-BR')}</b>
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-soft);">Gastaram +R$1.000 todo mês${periodoLabel6 ? ` (${periodoLabel6})` : ''}</div>
          ${relListToggle('gasta-mil', 'Gastaram +R$1000 todo mês', p.gastaMilTodoMesList)}
        </div>
      </div>

      <div class="rel-grid-2">
        <div class="rel-panel">
          <h4>Clientes por bairro (top 12) — ${p.bairros.reduce((s,b)=>s+b[1],0)} com bairro informado</h4>
          ${p.bairros.slice(0,12).map(([b,n],i)=> relRow(i+1, b, '', n+' clientes', maxBairro)).join('') || '<div class="empty-tab">Sem bairro informado na base.</div>'}
        </div>
        <div class="rel-panel">
          <h4>Clientes por faixa etária ${p.semIdade ? `<span style="font-weight:400; color:var(--ink-faint); font-size:11px;">(${p.semIdade} sem idade informada)</span>` : ''}</h4>
          ${p.faixaLabels.map((l,i)=> relRow(i+1, l, '', p.faixaCount[i]+' clientes', maxFaixa)).join('')}
        </div>
      </div>
    </div>
  `;
}

function wireProfileToggles(){
  ['compra-mes','gasta-mil'].forEach(id=>{
    const t = document.getElementById('toggle-'+id);
    if(!t) return;
    t.addEventListener('click', ()=>{
      const listEl = document.getElementById('list-'+id);
      const open = listEl.style.display !== 'none';
      listEl.style.display = open ? 'none' : 'block';
      t.textContent = t.textContent.replace(open?'▴':'▾', open?'▾':'▴');
    });
  });
}

function relRow(rank, name, sub, value, maxValue){
  const pct = maxValue>0 ? Math.max(4, (value/maxValue)*100) : 0;
  return `<div class="rel-row" style="flex-direction:column; align-items:stretch;">
    <div style="display:flex; align-items:center; gap:10px;">
      <span class="rel-rank">${rank}</span>
      <span class="rel-row-name">${name}</span>
      ${sub ? `<span class="rel-row-sub">${sub}</span>` : ''}
      <span class="rel-row-value">${value}</span>
    </div>
    <div class="rel-bar-track"><div class="rel-bar-fill" style="width:${pct}%;"></div></div>
  </div>`;
}

const QUARTER_LABEL = {1:'1º Trimestre (Jan-Mar)', 2:'2º Trimestre (Abr-Jun)', 3:'3º Trimestre (Jul-Set)', 4:'4º Trimestre (Out-Dez)'};

function buildYearsQuarters(){
  const years = [...new Set(PERIODOS.map(p=>Math.floor(p.sk/100)))].sort((a,b)=>b-a);
  const quartersByYear = {};
  PERIODOS.forEach(p=>{
    const ano = Math.floor(p.sk/100), mes = p.sk%100;
    const q = Math.ceil(mes/3);
    quartersByYear[ano] = quartersByYear[ano] || new Set();
    quartersByYear[ano].add(q);
  });
  return { years, quartersByYear };
}

function initRelatorio(){
  buildPeriodos();
  const { years, quartersByYear } = buildYearsQuarters();
  const el = document.getElementById('view-relatorio');
  el.innerHTML = `
    <div class="rel-controls">
      <select class="rel-select" id="rel-tipo">
        <option value="all">Geral (todo o período)</option>
        <option value="month">Mensal</option>
        <option value="quarter">Trimestral</option>
        <option value="year">Anual</option>
      </select>
      <select class="rel-select" id="rel-periodo-valor" style="display:none;"></select>
      <div class="vend-tabs" id="rel-vend-tabs">
        <div class="vend-tab active" data-vend="geral">Geral</div>
      </div>
    </div>
    <div id="rel-body"></div>
  `;

  const tipoSel = document.getElementById('rel-tipo');
  const valorSel = document.getElementById('rel-periodo-valor');

  function rebuildValorOptions(){
    const tipo = tipoSel.value;
    if(tipo==='all'){
      valorSel.style.display = 'none';
      currentPeriodoFilter = { type:'all' };
      renderRelatorioBody();
      return;
    }
    valorSel.style.display = 'inline-block';
    if(tipo==='month'){
      valorSel.innerHTML = PERIODOS.map(p=>`<option value="${p.sk}">${p.l}</option>`).join('');
      currentPeriodoFilter = { type:'month', sk: PERIODOS[0].sk };
    } else if(tipo==='quarter'){
      const opts = [];
      years.forEach(ano=>{
        [...quartersByYear[ano]].sort((a,b)=>b-a).forEach(q=>{
          opts.push(`<option value="${ano}-${q}">${QUARTER_LABEL[q]} ${ano}</option>`);
        });
      });
      valorSel.innerHTML = opts.join('');
      const [firstAno, firstQ] = valorSel.value.split('-').map(Number);
      currentPeriodoFilter = { type:'quarter', ano:firstAno, q:firstQ };
    } else if(tipo==='year'){
      valorSel.innerHTML = years.map(a=>`<option value="${a}">${a}</option>`).join('');
      currentPeriodoFilter = { type:'year', ano: years[0] };
    }
    renderRelatorioBody();
  }

  tipoSel.addEventListener('change', rebuildValorOptions);
  valorSel.addEventListener('change', ()=>{
    const tipo = tipoSel.value;
    if(tipo==='month'){
      currentPeriodoFilter = { type:'month', sk: parseInt(valorSel.value) };
    } else if(tipo==='quarter'){
      const [ano,q] = valorSel.value.split('-').map(Number);
      currentPeriodoFilter = { type:'quarter', ano, q };
    } else if(tipo==='year'){
      currentPeriodoFilter = { type:'year', ano: parseInt(valorSel.value) };
    }
    renderRelatorioBody();
  });

  renderRelatorioBody();
}

async function renderRelatorioBody(){
  const report = computeReport(currentPeriodoFilter);
  const bodyEl = document.getElementById('rel-body');

  // monta abas de vendedora dinamicamente com base nos nomes encontrados nas vendas
  const vendEntries = report.vendedoras.filter(([k,v])=> k && !/BAZAAR/i.test(k)).slice(0,8);
  const tabsEl = document.getElementById('rel-vend-tabs');
  tabsEl.innerHTML = `<div class="vend-tab ${currentVendTab==='geral'?'active':''}" data-vend="geral">Geral</div>` +
    vendEntries.map(([k,v])=>`<div class="vend-tab ${currentVendTab===k?'active':''}" data-vend="${k}">${v.display}</div>`).join('');
  tabsEl.onclick = (e)=>{
    const t = e.target.closest('.vend-tab');
    if(!t || !tabsEl.contains(t)) return;
    currentVendTab = t.dataset.vend;
    tabsEl.querySelectorAll('.vend-tab').forEach(x=>x.classList.toggle('active', x===t));
    renderClientRanking(report);
  };

  const maxCat = report.categorias.length ? report.categorias[0][1] : 0;
  const marcasPorValor = report.marcas.slice().sort((a,b)=>b[1].valor-a[1].valor).slice(0,10);
  const marcasPorQtd = report.marcas.slice().sort((a,b)=>b[1].qtd-a[1].qtd).slice(0,10);
  const produtosPorQtd = report.produtos.slice().sort((a,b)=>b[1].qtd-a[1].qtd).slice(0,10);
  const produtosPorValor = report.produtos.slice().sort((a,b)=>b[1].valor-a[1].valor).slice(0,10);
  const maxMarcaValor = marcasPorValor.length ? marcasPorValor[0][1].valor : 0;
  const maxMarcaQtd = marcasPorQtd.length ? marcasPorQtd[0][1].qtd : 0;
  const maxProdQtd = produtosPorQtd.length ? produtosPorQtd[0][1].qtd : 0;
  const maxProdValor = produtosPorValor.length ? produtosPorValor[0][1].valor : 0;

  function currentPeriodoLabel(){
    const f = currentPeriodoFilter;
    if(f.type==='all') return 'Todo o período (2024–2026)';
    if(f.type==='month') return PERIODOS.find(p=>p.sk===f.sk)?.l || '';
    if(f.type==='quarter') return `${QUARTER_LABEL[f.q]} ${f.ano}`;
    if(f.type==='year') return `Ano ${f.ano}`;
    return '';
  }

  bodyEl.innerHTML = `
    <p style="font-size:12.5px; color:var(--ink-soft); margin:-8px 0 16px;">Mostrando: <b style="color:var(--wine-dark);">${currentPeriodoLabel()}</b></p>
    <div class="rel-kpi-row">
      <div class="rel-kpi"><b>${money(report.totalValor)}</b><span>Total vendido</span></div>
      <div class="rel-kpi"><b>${report.totalQtd.toLocaleString('pt-BR')}</b><span>Itens vendidos</span></div>
      <div class="rel-kpi"><b>${money(report.ticketMedio)}</b><span>Ticket médio</span></div>
      <div class="rel-kpi"><b>${report.clientesAtivos.toLocaleString('pt-BR')}</b><span>Clientes que compraram</span></div>
    </div>

    <div class="rel-section" id="rel-meta-section"></div>

    ${renderPerfilBaseSection()}

    ${currentPeriodoFilter.type==='month' ? renderDiasHorariosSection(PERIODOS.find(p=>p.sk===currentPeriodoFilter.sk)?.l) : ''}

    <div class="rel-section">
      <div class="rel-section-title">Categorias mais vendidas</div>
      <div class="rel-panel">
        ${report.categorias.slice(0,10).map((c,i)=> relRow(i+1, c[0], '', money(c[1]), maxCat)).join('') || '<div class="empty-tab">Sem dados nesse período.</div>'}
      </div>
    </div>

    <div class="rel-section">
      <div class="rel-section-title">Marcas mais vendidas</div>
      <div class="rel-grid-2">
        <div class="rel-panel">
          <h4>Por valor (R$)</h4>
          ${marcasPorValor.map((m,i)=> relRow(i+1, m[0], m[1].qtd+' itens', money(m[1].valor), maxMarcaValor)).join('') || '<div class="empty-tab">Sem dados.</div>'}
        </div>
        <div class="rel-panel">
          <h4>Por quantidade de itens</h4>
          ${marcasPorQtd.map((m,i)=> relRow(i+1, m[0], money(m[1].valor), m[1].qtd+'x', maxMarcaQtd)).join('') || '<div class="empty-tab">Sem dados.</div>'}
        </div>
      </div>
    </div>

    <div class="rel-section">
      <div class="rel-section-title">Produtos mais vendidos</div>
      <div class="rel-grid-2">
        <div class="rel-panel">
          <h4>Por quantidade</h4>
          ${produtosPorQtd.map((p,i)=> relRow(i+1, p[0], money(p[1].valor), p[1].qtd+'x', maxProdQtd)).join('') || '<div class="empty-tab">Sem dados.</div>'}
        </div>
        <div class="rel-panel">
          <h4>Por valor (R$)</h4>
          ${produtosPorValor.map((p,i)=> relRow(i+1, p[0], p[1].qtd+'x', money(p[1].valor), maxProdValor)).join('') || '<div class="empty-tab">Sem dados.</div>'}
        </div>
      </div>
    </div>

    <div class="rel-section">
      <div class="rel-section-title">Ranking de clientes</div>
      <div class="rel-panel" id="rel-ranking-panel"></div>
    </div>
  `;

  renderClientRanking(report);
  renderMetaSection(report, vendEntries);
  wireProfileToggles();
}

function renderClientRanking(report){
  const panel = document.getElementById('rel-ranking-panel');
  let rows;
  if(currentVendTab==='geral'){
    rows = report.clientRows.slice().sort((a,b)=>b.valor-a.valor).slice(0,15);
  } else {
    rows = report.clientRows.filter(c=>c.perVendedora[currentVendTab]>0)
      .map(c=>({...c, valorVend: c.perVendedora[currentVendTab]}))
      .sort((a,b)=>b.valorVend-a.valorVend).slice(0,15);
  }
  const maxV = rows.length ? (currentVendTab==='geral' ? rows[0].valor : rows[0].valorVend) : 0;
  panel.innerHTML = rows.length ? rows.map((c,i)=>{
    const val = currentVendTab==='geral' ? c.valor : c.valorVend;
    const sub = currentVendTab==='geral' ? `${c.qtd} itens · ${c.catFav||'—'}` : `${c.qtd} itens`;
    return relRow(i+1, c.nome, sub, money(val), maxV);
  }).join('') : '<div class="empty-tab">Sem dados nesse período.</div>';
}

// ---------------- Meta x Realizado ----------------
function periodoKey(){
  if(currentPeriodoFilter.type!=='month') return null;
  const p = PERIODOS.find(x=>x.sk===currentPeriodoFilter.sk);
  return p ? p.l.replace('/','-') : null;
}

async function renderMetaSection(report, vendEntries){
  const sectionEl = document.getElementById('rel-meta-section');
  const key = periodoKey();
  if(!key){
    sectionEl.innerHTML = `
      <div class="rel-section-title">Meta x Realizado</div>
      <div class="rel-panel"><div class="empty-tab" style="padding:14px 4px;">Meta só se aplica a um mês específico — troque o filtro acima pra "Mensal" e escolha o mês pra ver e editar a meta de cada vendedora.</div></div>
    `;
    return;
  }
  let metas = {};
  try{
    const snap = await getDoc(doc(db, 'metas', key));
    if(snap.exists()) metas = snap.data();
  }catch(e){ /* sem meta salva ainda */ }

  const nomes = vendEntries.length ? vendEntries.map(([k,v])=>v.display) : Object.keys(metas);
  const realizadoPorVend = {};
  report.vendedoras.forEach(([k,v])=>{ realizadoPorVend[v.display] = (realizadoPorVend[v.display]||0) + v.valor; });

  sectionEl.innerHTML = `
    <div class="rel-section-title">Meta x Realizado — ${key.replace('-','/')}</div>
    <div class="meta-card">
      ${nomes.map(n=>{
        const meta = metas[n] || 0;
        const realizado = realizadoPorVend[n] || 0;
        const pct = meta>0 ? (realizado/meta*100) : 0;
        return `
        <div class="meta-row">
          <div class="meta-row-name">${n}</div>
          <input type="number" class="meta-input" data-vend="${n}" placeholder="Meta R$" value="${meta||''}">
          <div class="meta-bar-wrap">
            <div class="rel-bar-track"><div class="rel-bar-fill" style="width:${Math.min(100,pct)}%;"></div></div>
          </div>
          <div style="font-size:12px; color:var(--ink-soft); min-width:150px; text-align:right;">
            ${money(realizado)} ${meta>0 ? `<span class="meta-pct ${pct>=100?'ok':'bad'}">${pct.toFixed(0)}%</span>` : ''}
          </div>
        </div>`;
      }).join('')}
      <div style="display:flex; justify-content:flex-end; margin-top:12px;">
        <button class="save-btn" id="save-metas-btn">Salvar metas</button>
      </div>
    </div>
  `;

  document.getElementById('save-metas-btn').addEventListener('click', async ()=>{
    const btn = document.getElementById('save-metas-btn');
    btn.disabled = true; btn.textContent = 'Salvando...';
    const newMetas = {};
    sectionEl.querySelectorAll('.meta-input').forEach(inp=>{
      const v = parseFloat(inp.value);
      if(!isNaN(v) && v>0) newMetas[inp.dataset.vend] = v;
    });
    try{
      await setDoc(doc(db, 'metas', key), newMetas);
      showToast('Metas salvas');
      renderMetaSection(report, vendEntries);
    }catch(e){
      showToast('Erro ao salvar metas: '+e.message);
    }
    btn.disabled = false; btn.textContent = 'Salvar metas';
  });
}

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
