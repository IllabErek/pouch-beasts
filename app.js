(function(){
  const API = { base: "https://pokeapi.co/api/v2" };

  const STORE_KEYS = {
    gens: "ptd_enabledGens_v2",
    run: "ptd_currentRun_v2",
    saved: "ptd_savedTeams_v2",
    plans: "ptd_plans_v2"
  };

  const OLD_KEYS = { savedTeams: "pk_draft_saved_teams_v1" };

  const DEFAULT_ENABLED_GENS = [1,2,3,4,5,6,7,8];

  const DATA_PATHS = {
    abilityNames: "data/AbilityNames.json",
    itemNames: "data/ItemNames.json",
    moveNames: "data/MoveNames.json",
    moveData: "data/MoveData.json",
    typeNames: "data/TypeNames.json",
    natureNames: "data/NatureNames.json",
    speciesNames: "data/SpeciesNames.json",
    speciesNamesAlts: "data/SpeciesNamesAlts.json",
    speciesToDex: "data/SpeciesToDexNum.json",
    dexNum: "data/DexNum.json",
    spriteMap: "data/SpriteMap.json",
    baseStats: "data/unbound/BaseStats.json",
    levelUp: "data/LevelUpLearnsets.json",
    egg: "data/EggMoves.json",
    tm: "data/TMCompatibility.json",
    tutor: "data/TutorCompatibility.json"
  };

  function byId(id){ return document.getElementById(id); }

  function safeJsonParse(s, fallback){
    try { return JSON.parse(s); } catch(_) { return fallback; }
  }

  function loadJson(key, fallback){
    const v = localStorage.getItem(key);
    if(v == null) return fallback;
    return safeJsonParse(v, fallback);
  }

  function saveJson(key, value){
    localStorage.setItem(key, JSON.stringify(value));
  }

  function nowIso(){ return new Date().toISOString(); }

  function uid(){
    return `${Date.now()}_${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;
  }

  function titleCaseName(name){
    if(!name) return "";
    return String(name)
      .replaceAll("_","-")
      .split("-")
      .map(part => part ? part[0].toUpperCase() + part.slice(1) : part)
      .join(" ");
  }

  function normalizeKey(s){
    return String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g,"")
      .trim();
  }

  async function fetchJson(url){
    const r = await fetch(url, { cache: "force-cache" });
    if(!r.ok){
      const err = new Error(`Fetch failed ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return await r.json();
  }

  const genCache = new Map();

  async function getGenSpecies(gen, data){
    const g = Number(gen)||0;
    const cacheKey = `g${g}`;
    if(genCache.has(cacheKey)) return genCache.get(cacheKey);

    const dexNum = data.dexNum || {};
    const speciesToDex = data.speciesToDex || {};
    const allSpecies = data.allSpeciesConsts || [];

    const ranges = {
      1: [1,151],
      2: [152,251],
      3: [252,386],
      4: [387,493],
      5: [494,649],
      6: [650,721],
      7: [722,809],
      8: [810,905],
      9: [906,1025]
    };
    const r = ranges[g];
    if(!r){ genCache.set(cacheKey, []); return []; }
    const [lo,hi] = r;

    const inGen = [];
    for(const sc of allSpecies){
      const dexKey = speciesToDex[sc];
      const n = dexKey ? Number(dexNum[dexKey]||0) : 0;
      if(n >= lo && n <= hi) inGen.push(sc);
    }

    genCache.set(cacheKey, inGen);
    return inGen;
  }



  function getEnabledGens(){
    const v = loadJson(STORE_KEYS.gens, null);
    if(Array.isArray(v) && v.length){
      const filtered = v.map(n => Number(n)).filter(n => Number.isFinite(n) && n >= 1 && n <= 8);
      if(filtered.length) return Array.from(new Set(filtered)).sort((a,b)=>a-b);
    }
    return DEFAULT_ENABLED_GENS.slice();
  }

  function setEnabledGens(gens){
    const uniq = Array.from(new Set((gens || []).map(n => Number(n)).filter(n => Number.isFinite(n) && n >= 1 && n <= 8))).sort((a,b)=>a-b);
    saveJson(STORE_KEYS.gens, uniq);
  }

  function getRun(){
    const run = loadJson(STORE_KEYS.run, null);
    if(run && Array.isArray(run.team) && Array.isArray(run.choices)){
      if(!Array.isArray(run.seen)) run.seen = [];
      if(!Array.isArray(run.enabledGens)) run.enabledGens = getEnabledGens();
      return run;
    }
    return { team: [], choices: [], seen: [], enabledGens: getEnabledGens() };
  }

  function setRun(run){ saveJson(STORE_KEYS.run, run); }

  function clearRun(){ localStorage.removeItem(STORE_KEYS.run); }

  function getSavedTeams(){
    const v = loadJson(STORE_KEYS.saved, []);
    return Array.isArray(v) ? v : [];
  }

  function setSavedTeams(teams){ saveJson(STORE_KEYS.saved, teams); }

  function upsertTeam(team){
    const teams = getSavedTeams();
    const i = teams.findIndex(t => t.id === team.id);
    if(i >= 0) teams[i] = team;
    else teams.unshift(team);
    setSavedTeams(teams);
  }

  function deleteTeam(teamId){
    const teams = getSavedTeams().filter(t => t.id !== teamId);
    setSavedTeams(teams);
    const plans = loadJson(STORE_KEYS.plans, {});
    if(plans && typeof plans === "object"){
      delete plans[teamId];
      saveJson(STORE_KEYS.plans, plans);
    }
  }

  function getPlans(){
    const v = loadJson(STORE_KEYS.plans, {});
    return v && typeof v === "object" ? v : {};
  }

  function setPlans(plans){ saveJson(STORE_KEYS.plans, plans); }

  function spriteFromApiPokemon(p){
    const s = p && p.sprites ? p.sprites : null;
    const a = s && s.other && s.other["official-artwork"] ? s.other["official-artwork"].front_default : "";
    return (s && s.front_default) || a || "";
  }

  async function getPokemonDetailsResolved(speciesConst, data){
    const sc = String(speciesConst || "").trim();
    if(!sc) throw new Error("Empty species");

    const speciesNames = data.speciesNames || {};
    const speciesNamesAlts = data.speciesNamesAlts || {};
    const speciesToDex = data.speciesToDex || {};
    const dexNum = data.dexNum || {};
    const baseStats = data.baseStats || {};
    const typeNames = data.typeNames || {};
    const spriteMap = data.spriteMap || {};
    const fallbackSprite = spriteMap.SPECIES_NONE || "Dynamic-Pokemon-Expansion-Unbound/graphics/frontspr/gFrontSprite000None.png";

    const name = speciesNamesAlts[sc] || speciesNames[sc] || sc.replace(/^SPECIES_/, "").toLowerCase();
    const dexKey = speciesToDex[sc];
    const id = dexKey ? Number(dexNum[dexKey] || 0) : 0;

    const bs = baseStats[sc] || {};
    const t1 = bs.type1 ? (typeNames[bs.type1] || bs.type1) : "";
    const t2 = bs.type2 && bs.type2 !== "TYPE_NONE" ? (typeNames[bs.type2] || bs.type2) : "";
    const rawTypes = [t1, t2].filter(Boolean).map(s => String(s));
    const seen = new Set();
    const types = [];
    for(const t of rawTypes){
      const k = String(t).toLowerCase();
      if(!k) continue;
      if(seen.has(k)) continue;
      seen.add(k);
      types.push(t);
    }

    const sprite = spriteMap[sc] || fallbackSprite;

    return { speciesConst: sc, name, id, types, sprite };
  }



  const apiMovePoolCache = new Map();

  async function getApiMovePools(apiName){
    const key = String(apiName || "").trim().toLowerCase();
    if(!key) return { all:[], level:[], egg:[], tm:[], tutor:[] };
    if(apiMovePoolCache.has(key)) return apiMovePoolCache.get(key);

    const d = await getPokemonDetailsResolved(key);
    const pools = { all:[], level:[], egg:[], tm:[], tutor:[] };
    const moves = Array.isArray(d.moves) ? d.moves : [];

    const add = (poolKey, moveName) => {
      const nm = titleCaseName(moveName);
      if(!nm) return;
      pools[poolKey].push(nm);
      pools.all.push(nm);
    };

    for(const m of moves){
      const mn = m && m.move && m.move.name ? m.move.name : null;
      if(!mn) continue;
      const vgd = Array.isArray(m.version_group_details) ? m.version_group_details : [];
      // If any version group lists a learn method, we include it in that pool
      let hasLevel = false, hasEgg = false, hasTM = false, hasTutor = false;
      for(const det of vgd){
        const method = det && det.move_learn_method && det.move_learn_method.name ? det.move_learn_method.name : "";
        if(method === "level-up") hasLevel = true;
        else if(method === "egg") hasEgg = true;
        else if(method === "machine") hasTM = true;
        else if(method === "tutor") hasTutor = true;
      }
      if(hasLevel) add("level", mn);
      if(hasEgg) add("egg", mn);
      if(hasTM) add("tm", mn);
      if(hasTutor) add("tutor", mn);
    }

    pools.all = uniqStrings(pools.all).sort((a,b)=>a.localeCompare(b));
    pools.level = uniqStrings(pools.level).sort((a,b)=>a.localeCompare(b));
    pools.egg = uniqStrings(pools.egg).sort((a,b)=>a.localeCompare(b));
    pools.tm = uniqStrings(pools.tm).sort((a,b)=>a.localeCompare(b));
    pools.tutor = uniqStrings(pools.tutor).sort((a,b)=>a.localeCompare(b));

    apiMovePoolCache.set(key, pools);
    return pools;
  }

  const eggRootCache = new Map();

  async function getEggRootConstForApiName(apiName, data){
    const key = String(apiName || "").trim().toLowerCase();
    if(!key || !data || !data.speciesNameToConst) return null;
    if(eggRootCache.has(key)) return eggRootCache.get(key);

    let cur = key;
    const visited = new Set();
    while(cur && !visited.has(cur)){
      visited.add(cur);
      let species;
      try{
        species = await fetchJson(`${API.base}/pokemon-species/${encodeURIComponent(cur)}/`);
      } catch(_){
        break;
      }
      const prev = species && species.evolves_from_species && species.evolves_from_species.name
        ? String(species.evolves_from_species.name).trim().toLowerCase()
        : "";
      if(!prev) break;
      cur = prev;
    }

    const disp = titleCaseName(cur);
    const constKey = data.speciesNameToConst[normalizeKey(disp)] || null;
    eggRootCache.set(key, constKey);
    return constKey;
  }

  async function roll3(enabledGens, alreadyPicked, data, seenList){
    const gens = Array.isArray(enabledGens) && enabledGens.length ? enabledGens : DEFAULT_ENABLED_GENS;

    const isExcluded = (sc) => {
  const s = String(sc || "");
  if(!s.startsWith("SPECIES_")) return true;

  // Explicit battle-only / temporary / not-draftable sets
  if(/_(MEGA|GIGA|GMAX|TOTEM|PRIMAL|ETERNAMAX|BATTLE_BOND|ASH|CAP|COSPLAY)$/i.test(s)) return true;
  if(s.includes("_MEGA_")) return true;

  // Large cosmetic/pattern sets: keep only the base species entry
  const cosmeticBases = [
    "SPECIES_ARCEUS",
    "SPECIES_SILVALLY",
    "SPECIES_VIVILLON",
    "SPECIES_UNOWN",
    "SPECIES_ALCREMIE",
    "SPECIES_MINIOR",
    "SPECIES_FURFROU",
    "SPECIES_DEERLING",
    "SPECIES_SAWSBUCK",
    "SPECIES_FLABEBE",
    "SPECIES_FLOETTE",
    "SPECIES_FLORGES",
    "SPECIES_PUMPKABOO",
    "SPECIES_GOURGEIST",
    "SPECIES_PIKACHU"
  ];
  for(const b of cosmeticBases){
    if(s.startsWith(b + "_") && s !== b) return true;
  }

  // Regional-only rolling: exclude non-regional form variants (keep them searchable via manual search).
  const hasRegional = /_(ALOLA|ALOLAN|GALAR|GALARIAN|HISUI|HISUIAN)\b/i.test(s) || /_(A|G|H)$/i.test(s);
  if(!hasRegional && s.includes('_') && data){
    const hasKey = (k) => !!((data.baseStats && data.baseStats[k]) || (data.speciesConstToName && data.speciesConstToName[k]));
    let base = s;
    while(base.includes('_')){
      base = base.replace(/_[^_]+$/,'');
      if(hasKey(base)) { if(base !== s) return true; break; }
    }
  }

  return false;
};

    const all = [];
    for(const g of gens){
      const list = await getGenSpecies(g, data);
      for(const sc of list){
        if(isExcluded(sc)) continue;
        all.push(sc);
      }
    }

    const pickedSet = new Set((alreadyPicked || []).map(m => String(m.speciesConst || "").trim()).filter(Boolean));
    const uniqAll = Array.from(new Set(all)).filter(sc => !pickedSet.has(sc));

    const seenSet = new Set((seenList || []).map(x => String(x || "").trim()).filter(Boolean));
    const remaining = uniqAll.filter(sc => !seenSet.has(sc));

    if(remaining.length < 3) throw new Error("Not enough remaining species to roll from the selected gens.");

    const picks = [];
    while(picks.length < 3){
      const idx = Math.floor(Math.random() * remaining.length);
      const sc = remaining[idx];
      if(picks.includes(sc)) continue;
      picks.push(sc);
    }

    const details = await Promise.all(picks.map(async (sc) => {
      return await getPokemonDetailsResolved(sc, data);
    }));

    return details;
  }


  function renderGenToggles(container, enabledGens, onChange){
    container.innerHTML = "";
    for(let g = 1; g <= 8; g++){
      const on = enabledGens.includes(g);
      const el = document.createElement("label");
      el.className = "genToggle" + (on ? " on" : "");
      el.innerHTML = `<span>Gen ${g}</span><input type="checkbox" ${on ? "checked" : ""} aria-label="Toggle generation ${g}">`;
      const cb = el.querySelector("input");
      cb.addEventListener("change", () => {
        const next = new Set(enabledGens);
        if(cb.checked) next.add(g);
        else next.delete(g);
        onChange(Array.from(next).sort((a,b)=>a-b));
      });
      container.appendChild(el);
    }
  }

  function renderTeamSlots(container, team, opts){
    const onRemove = opts && typeof opts.onRemove === "function" ? opts.onRemove : null;
    const onSelect = opts && typeof opts.onSelect === "function" ? opts.onSelect : null;
    const activeIndex = opts && typeof opts.activeIndex === "number" ? opts.activeIndex : -1;

    container.innerHTML = "";
    for(let i = 0; i < 6; i++){
      const mon = team[i] || null;
      const el = document.createElement("div");
      el.className = "slot" + (mon ? " filled" : "") + (i === activeIndex ? " active" : "");

      if(mon){
        el.innerHTML = `
          <img class="miniSprite" src="${mon.sprite || ""}" alt="">
          <div class="slotText">
            <div class="slotName" data-fittext>${escapeHtml(titleCaseName(mon.name))}</div>
            <div class="slotSub">#${escapeHtml(String(mon.id || "").padStart(3,"0"))}</div>
          </div>
          <div class="slotActions">
            <button class="iconBtn" data-remove="${i}" aria-label="Remove">Remove</button>
          </div></details>
        `;
      } else {
        el.innerHTML = `
          <div class="slotText">
            <div class="slotName muted" data-fittext>Empty slot</div>
            <div class="slotSub">Roll and pick</div>
          </div></details>
        `;
      }

      el.addEventListener("click", (e) => {
        const t = e.target;
        if(t && t instanceof HTMLElement && t.hasAttribute("data-remove")) return;
        if(onSelect) onSelect(i);
      });

      const rm = el.querySelector("[data-remove]");
      if(rm && onRemove){
        rm.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          onRemove(i);
        });
      }

      container.appendChild(el);
    }

    const fitEls = Array.from(container.querySelectorAll("[data-fittext]"));
    for(const fe of fitEls) fitTextToParent(fe, 12);
  }

  function fitTextToParent(el, minPx){
    if(!el) return;
    const parent = el.parentElement;
    if(!parent) return;
    const max = parent.clientWidth;
    if(!max) return;

    el.style.fontSize = "";
    const cs = window.getComputedStyle(el);
    const start = Math.floor(parseFloat(cs.fontSize) || 16);
    let size = start;
    const min = Math.max(10, parseInt(minPx, 10) || 12);

    // Try single-line shrink-to-fit first
    el.style.whiteSpace = "nowrap";
    el.style.display = "block";
    el.style.maxWidth = "100%";

    const tooWide = () => el.scrollWidth > el.clientWidth + 1;

    while(size > min && tooWide()){
      size -= 1;
      el.style.fontSize = size + "px";
    }

    // If it still doesn't fit at minimum size, allow wrapping (no word breaking, no ellipsis)
    if(tooWide()){
      el.style.whiteSpace = "normal";
      el.style.wordBreak = "normal";
      el.style.overflowWrap = "normal";
    }
  }


  function renderChoices(container, choices, onPick){
    container.innerHTML = "";
    if(!choices || !choices.length){
      container.innerHTML = `<div class="muted small">No roll yet.</div>`;
      return;
    }
    for(const c of choices){
      const el = document.createElement("div");
      el.className = "choice";
      el.innerHTML = `
        <div class="choiceTop">
          <img class="sprite" src="${c.sprite || ""}" alt="">
          <div class="choiceText">
            <div class="choiceName">${escapeHtml(c.name)}</div>
            <div class="choiceMeta">#${String(c.id).padStart(3,"0")} · ${c.types.map(titleCaseName).join(" / ")}</div>
          </div>
        </div>
      `;
      el.addEventListener("click", () => onPick(c));
      container.appendChild(el);
    }
  }

  function fmtDate(iso){
    try{
      const d = new Date(iso);
      return d.toLocaleString();
    } catch(_){
      return iso || "";
    }
  }

  function escapeHtml(s){
    return String(s || "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function migrateOldTeamsIfNeeded(){
    const existing = getSavedTeams();
    if(existing.length) return;

    const old = loadJson(OLD_KEYS.savedTeams, null);
    if(!old || !Array.isArray(old) || !old.length) return;

    const migrated = old.map(entry => {
      const mons = Array.isArray(entry.team) ? entry.team : [];
      return {
        id: entry.id || uid(),
        name: entry.name && String(entry.name).trim() ? String(entry.name).trim() : "Untitled team",
        createdAt: entry.createdAt || nowIso(),
        mons: mons.slice(0,6).map(m => ({
          name: (m.name || "").toLowerCase(),
          id: m.id || 0,
          sprite: m.sprite || "",
          types: m.types || []
        }))
      };
    });

    setSavedTeams(migrated);
  }

  async function initDrafter(){
    migrateOldTeamsIfNeeded();

    const data = await loadPlannerData();

    const genToggles = byId("genToggles");
    const rollBtn = byId("rollBtn");
    const restartBtn = byId("restartBtn");
    const saveBtn = byId("saveBtn");
    const status = byId("status");
    const teamSlots = byId("teamSlots");
    const choicesEl = byId("choices");
    const pickCount = byId("pickCount");
    const allGensBtn = byId("allGensBtn");
    const noneGensBtn = byId("noneGensBtn");
    const manualAddInput = byId("manualAddInput");
    const manualAddBtn = byId("manualAddBtn");
    const manualClearBtn = byId("manualClearBtn");
    const pokemonDatalist = byId("pokemonDatalist");

    let run = getRun();
    let enabledGens = run.enabledGens && run.enabledGens.length ? run.enabledGens : getEnabledGens();
    run.enabledGens = enabledGens;
    setEnabledGens(enabledGens);
    setRun(run);

    let activeSlot = 0;

    const labelToSpecies = new Map();
    const normLabelToSpecies = new Map();

    async function buildPokemonDatalist(){
      if(!pokemonDatalist) return;
      pokemonDatalist.innerHTML = "";
      labelToSpecies.clear();
      normLabelToSpecies.clear();
      if(!enabledGens || !enabledGens.length) return;

      const all = [];
      for(const g of enabledGens){
        try{
          const list = await getGenSpecies(g, data);
          for(const sc of list) all.push(sc);
        } catch(_){ }
      }

      const isExcluded = (sc) => {
  const s = String(sc || "");
  if(!s.startsWith("SPECIES_")) return true;

  // Explicit battle-only / temporary / not-draftable sets
  if(/_(MEGA|GIGA|GMAX|TOTEM|PRIMAL|ETERNAMAX|BATTLE_BOND|ASH|CAP|COSPLAY)$/i.test(s)) return true;
  if(s.includes("_MEGA_")) return true;

  // Large cosmetic/pattern sets: keep only the base species entry
  const cosmeticBases = [
    "SPECIES_ARCEUS",
    "SPECIES_SILVALLY",
    "SPECIES_VIVILLON",
    "SPECIES_UNOWN",
    "SPECIES_ALCREMIE",
    "SPECIES_MINIOR",
    "SPECIES_FURFROU",
    "SPECIES_DEERLING",
    "SPECIES_SAWSBUCK",
    "SPECIES_FLABEBE",
    "SPECIES_FLOETTE",
    "SPECIES_FLORGES",
    "SPECIES_PUMPKABOO",
    "SPECIES_GOURGEIST",
    "SPECIES_PIKACHU"
  ];
  for(const b of cosmeticBases){
    if(s.startsWith(b + "_") && s !== b) return true;
  }

  return false;
};

      const uniq = Array.from(new Set(all)).filter(sc => !isExcluded(sc)).sort((a,b)=>a.localeCompare(b));
      for(const sc of uniq){
        const label = (data.speciesNamesAlts && data.speciesNamesAlts[sc]) || (data.speciesNames && data.speciesNames[sc]) || sc.replace(/^SPECIES_/, "");
        const opt = document.createElement("option");
        opt.value = label;
        pokemonDatalist.appendChild(opt);

        const norm = normalizeKey(label);
        if(!normLabelToSpecies.has(norm)){
          normLabelToSpecies.set(norm, sc);
        }
        labelToSpecies.set(label, sc);
      }
    }


    const normalizeManualName = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g,"-");

    async function addPokemonManually(){
      if(!manualAddInput) return;
      const raw = String(manualAddInput.value || "").trim();
      if(!raw){
        status.textContent = "Type a Pokemon name.";
        return;
      }

      const sc = normLabelToSpecies.get(normalizeKey(raw));
      if(!sc){
        status.textContent = "No match. Use the dropdown suggestions.";
        return;
      }

      try{
        const picked = await getPokemonDetailsResolved(sc, data);

        if(run.team.some(m => m && m.speciesConst === picked.speciesConst)){
          status.textContent = "Already in your team.";
          syncUI();
          return;
        }

        if(run.team.length < 6){
          run.team.push(picked);
          activeSlot = Math.min(run.team.length, 5);
        } else {
          const idx = Math.max(0, Math.min(5, activeSlot));
          run.team[idx] = picked;
        }

        run.choices = [];
        setRun(run);
        status.textContent = `Added ${picked.name}.`;
        syncUI();
      } catch(e){
        status.textContent = String(e && e.message ? e.message : e);
      }
    }

async function doRoll(){
      status.textContent = "Rolling...";
      if(!enabledGens.length){
        status.textContent = "Enable at least one generation.";
        return;
      }
      if(run.team.length >= 6){
        status.textContent = "Team is already full. Restart or save.";
        return;
      }
      const choices = await roll3(enabledGens, run.team, data, run.seen);
      run.choices = choices;
      {
        const seenSet = new Set(Array.isArray(run.seen) ? run.seen : []);
        for(const c of (choices || [])){
          if(c && c.speciesConst) seenSet.add(String(c.speciesConst));
        }
        run.seen = Array.from(seenSet);
      }
      setRun(run);
      status.textContent = "Pick one.";
      syncUI();
    }

    function syncUI(){
      pickCount.textContent = String(run.team.length);
      if(run.team.length < 6) activeSlot = run.team.length;
      renderTeamSlots(teamSlots, run.team, {
        activeIndex: activeSlot,
        onSelect: (i) => { activeSlot = i; syncUI(); },
        onRemove: (i) => {
          if(!run.team[i]) return;
          run.team.splice(i,1);
          run.choices = [];
          setRun(run);
          activeSlot = Math.min(run.team.length, 5);
          status.textContent = "Removed.";
          syncUI();
        }
      });
      renderChoices(choicesEl, run.choices, async (picked) => {
        if(run.team.length >= 6) return;
        run.team.push(picked);
        run.choices = [];
        setRun(run);
        syncUI();
        status.textContent = `Picked ${titleCaseName(picked.name)}.`;
        if(run.team.length >= 6){
          status.textContent = "Team complete. Save it or restart.";
          return;
        }
        try{ await doRoll(); }
        catch(e){ status.textContent = String(e && e.message ? e.message : e); }
      });
      saveBtn.disabled = run.team.length !== 6;

      renderGenToggles(genToggles, enabledGens, (next) => {
        enabledGens = next;
        run.enabledGens = enabledGens;
        setEnabledGens(enabledGens);
        setRun(run);
        status.textContent = enabledGens.length ? `Enabled gens: ${enabledGens.join(", ")}` : "Enable at least one generation.";
        buildPokemonDatalist();
      });
    }

    allGensBtn.addEventListener("click", () => {
      enabledGens = DEFAULT_ENABLED_GENS.slice();
      run.enabledGens = enabledGens;
      setEnabledGens(enabledGens);
      setRun(run);
      status.textContent = `Enabled gens: ${enabledGens.join(", ")}`;
      syncUI();
      buildPokemonDatalist();
    });

    noneGensBtn.addEventListener("click", () => {
      enabledGens = [];
      run.enabledGens = enabledGens;
      setEnabledGens(enabledGens);
      setRun(run);
      status.textContent = "Enable at least one generation.";
      syncUI();
      buildPokemonDatalist();
    });

    rollBtn.addEventListener("click", async () => {
      try{ await doRoll(); }
      catch(e){ status.textContent = String(e && e.message ? e.message : e); }
    });

    restartBtn.addEventListener("click", () => {
      run = { team: [], choices: [], seen: [], enabledGens: enabledGens.slice() };
      setRun(run);
      status.textContent = "Restarted.";
      activeSlot = 0;
      syncUI();
    });

    saveBtn.addEventListener("click", () => {
      if(run.team.length !== 6) return;
      const team = {
        id: uid(),
        name: `Team ${new Date().toLocaleDateString()}`,
        createdAt: nowIso(),
        mons: run.team.map(m => ({
          name: m.name,
          id: m.id,
          sprite: m.sprite || "",
          types: m.types || []
        }))
      };
      upsertTeam(team);
      status.textContent = "Saved. Opening Teams...";
      clearRun();
      window.location.href = "teams.html";
    });

    syncUI();
    status.textContent = enabledGens.length ? `Enabled gens: ${enabledGens.join(", ")}` : "Enable at least one generation.";
    buildPokemonDatalist();

    if(manualAddBtn) manualAddBtn.addEventListener("click", addPokemonManually);
    if(manualAddInput) manualAddInput.addEventListener("keydown", (e) => {
      if(e.key === "Enter"){
        e.preventDefault();
        addPokemonManually();
      }
    });
    if(manualClearBtn) manualClearBtn.addEventListener("click", () => {
      if(manualAddInput) manualAddInput.value = "";
      status.textContent = "Cleared.";
    });
  }

  function initTeamsPage(){
    migrateOldTeamsIfNeeded();

    const listEl = byId("teamsList");
    const countEl = byId("teamsCount");

    function render(){
      const teams = getSavedTeams();
      countEl.textContent = `${teams.length} saved team${teams.length === 1 ? "" : "s"}.`;

      listEl.innerHTML = "";
      if(!teams.length){
        listEl.innerHTML = `<div class="muted small">No saved teams yet. Go draft one.</div>`;
        return;
      }

      for(const t of teams){
        const row = document.createElement("div");
        row.className = "teamCard";

        const sprites = (t.mons || []).slice(0,6).map(m => m.sprite || "");
        const spriteHtml = sprites.map(s => `<img class="miniSprite" src="${s}" alt="">`).join("");

        row.innerHTML = `
          <div class="teamCardLeft">
            <div class="teamRow">
              <div class="sectionTitle">${escapeHtml(t.name || "Untitled team")}</div>
              <div class="badge">${fmtDate(t.createdAt)}</div>
            </div>
            <div class="teamRow">${spriteHtml}</div>
          </div>
          <div class="teamRow">
            <a class="btn primary" href="planner.html?team=${encodeURIComponent(t.id)}">Open in planner</a>
            <button class="btn" data-action="rename">Rename</button>
            <button class="btn" data-action="delete">Delete</button>
          </div>
        `;

        row.querySelector('[data-action="rename"]').addEventListener("click", () => {
          const next = prompt("New team name:", t.name || "");
          if(next == null) return;
          const name = String(next).trim();
          t.name = name || "Untitled team";
          upsertTeam(t);
          render();
        });

        row.querySelector('[data-action="delete"]').addEventListener("click", () => {
          const ok = confirm("Delete this team and its planner data?");
          if(!ok) return;
          deleteTeam(t.id);
          render();
        });

        listEl.appendChild(row);
      }
    }

    render();
  }

  function clampInt(n, min, max){
    const x = parseInt(n, 10);
    if(Number.isNaN(x)) return min;
    return Math.max(min, Math.min(max, x));
  }

  function defaultPlan(){
    return {
      ability: "",
      item: "",
      nature: "",
      level: 50,
      movePool: "all",
      moves: ["","","",""],
      evs: { hp:0, atk:0, def:0, spa:0, spd:0, spe:0 },
      ivs: { hp:31, atk:31, def:31, spa:31, spd:31, spe:31 },
      notes: ""
    };
  }

  function buildDatalistItems(dl, items){
  dl.innerHTML = "";
  const add = (name) => {
    const v = String(name || "").trim();
    if(!v || v === "-") return;
    const opt = document.createElement("option");
    opt.value = v;
    dl.appendChild(opt);
  };
  if(!items || typeof items !== "object") return;
  for(const v of Object.values(items)){
    if(typeof v === "string") add(v);
    else if(v && typeof v === "object" && typeof v.name === "string") add(v.name);
  }
}

async function loadPlannerData(
){
    const base = await Promise.all([
      fetchJson(DATA_PATHS.abilityNames),
      fetchJson(DATA_PATHS.itemNames),
      fetchJson(DATA_PATHS.moveNames),
      fetchJson(DATA_PATHS.moveData),
      fetchJson(DATA_PATHS.typeNames),
      fetchJson(DATA_PATHS.natureNames),
      fetchJson(DATA_PATHS.speciesNames),
      fetchJson(DATA_PATHS.speciesNamesAlts),
      fetchJson(DATA_PATHS.speciesToDex),
      fetchJson(DATA_PATHS.dexNum),
      fetchJson(DATA_PATHS.spriteMap),
      fetchJson(DATA_PATHS.baseStats)
    ]);


const abilityNames = base[0];
    const itemNames = base[1];
    const moveNames = base[2];
    const moveData = base[3];
    const typeNames = base[4];
    const natureNames = base[5];
    const speciesNames = base[6];
    const speciesNamesAlts = base[7];
    const speciesToDex = base[8];
    const dexNum = base[9];
    const spriteMap = base[10];
    const baseStats = base[11];

    const speciesNameToConst = {};
    const isAltFormConst = (c) => {
      if(!c) return false;
      const s = String(c);
      return /_(MEGA|GIGA|GMAX|TOTEM|PRIMAL|ETERNAMAX|BATTLE_BOND|ASH|CAP|COSPLAY|ZEN|SCHOOL|BUSTED|DISGUISED|HERO|CROWNED|THERIAN|COMPLETE|TEN_PERCENT|FIFTY_PERCENT|POWER_CONSTRUCT|ORIGIN|SKY|BLOODMOON)/.test(s);
    };

    for(const [k,v] of Object.entries(speciesNames)){
      if(typeof v !== "string") continue;
      const nk = normalizeKey(v);
      if(!nk) continue;
      const existing = speciesNameToConst[nk];
      if(!existing){
        speciesNameToConst[nk] = k;
        continue;
      }
      const existingIsAlt = isAltFormConst(existing);
      const nextIsAlt = isAltFormConst(k);
      if(existingIsAlt && !nextIsAlt){
        speciesNameToConst[nk] = k;
      }
    }

    const moveNameToConst = {};

    if(speciesNamesAlts && typeof speciesNamesAlts === "object"){
      for(const [k,v] of Object.entries(speciesNamesAlts)){
        if(typeof v !== "string") continue;
        const nk = normalizeKey(v);
        if(!nk) continue;
        if(!(nk in speciesNameToConst)) speciesNameToConst[nk] = k;
      }
    }

    const allSpeciesConsts = Array.from(new Set([
      ...Object.keys(speciesNames || {}),
      ...Object.keys(speciesNamesAlts || {})
    ]));

    for(const [k,v] of Object.entries(moveNames)){
      if(typeof v !== "string") continue;
      const nk = normalizeKey(v);
      if(nk) moveNameToConst[nk] = k;
    }

const naturesList = Object.values(natureNames).filter(v => typeof v === "string" && v);

    let levelUp = null, egg = null, tm = null, tutor = null;
    try{ levelUp = await fetchJson(DATA_PATHS.levelUp); } catch(_){}
    try{ egg = await fetchJson(DATA_PATHS.egg); } catch(_){}
    try{ tm = await fetchJson(DATA_PATHS.tm); } catch(_){}
    try{ tutor = await fetchJson(DATA_PATHS.tutor); } catch(_){}

    return {
      abilityNames,
      itemNames,
      moveNames,
      moveNameToConst,
      moveData,
      typeNames,
      natureNames,
      naturesList,
      speciesNames,
      speciesNamesAlts,
      speciesNameToConst,
      speciesToDex,
      dexNum,
      spriteMap,
      allSpeciesConsts,
      baseStats,
      levelUp,
      egg,
      tm,
      tutor
    };
  }

  function moveConstToDisplay(data, moveConst){
    if(!data || !data.moveNames) return "";
    const v = data.moveNames[moveConst];
    return typeof v === "string" ? v : "";
  }

  function uniqStrings(arr){
    const out = [];
    const seen = new Set();
    for(const s of arr){
      if(!s || typeof s !== "string") continue;
      const k = s.toLowerCase();
      if(seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out;
  }

  function poolForSpecies(data, speciesConst, pool, eggSpeciesConst){
    if(!data) return [];
    const p = pool || "all";
    const out = [];

    if(p === "level" || p == "all"){
      if(data.levelUp && data.levelUp[speciesConst]){
        for(const entry of data.levelUp[speciesConst]){
          const name = moveConstToDisplay(data, entry.move);
          if(name) out.push(name);
        }
      }
    }

    if(p === "egg" || p == "all"){
      const eggKey = eggSpeciesConst || speciesConst;
      if(data.egg && data.egg[eggKey]){
        for(const mc of data.egg[eggKey]){
          const name = moveConstToDisplay(data, mc);
          if(name) out.push(name);
        }
      }
    }

    if(p === "tm" || p == "all"){
      if(data.tm && data.tm[speciesConst]){
        for(const mn of data.tm[speciesConst]) out.push(mn);
      }
    }

    if(p === "tutor" || p == "all"){
      if(data.tutor && data.tutor[speciesConst]){
        for(const mn of data.tutor[speciesConst]) out.push(mn);
      }
    }

    return uniqStrings(out).sort((a,b)=>a.localeCompare(b));
  }

  function moveDetailsByName(data, moveName){
    if(!data) return null;
    const c = data.moveNameToConst[normalizeKey(moveName)];
    if(!c) return null;
    const d = data.moveData[c];
    if(!d) return null;
    const type = data.typeNames[d.type] || d.type || "";
    const split = String(d.split || "").replace("SPLIT_","").toLowerCase();
    const pp = d.pp != null ? String(d.pp) : "";
    return { type, split, pp };
  }

  const NATURE_EFFECTS = {
    Lonely: { up: "atk", down: "def" },
    Brave: { up: "atk", down: "spe" },
    Adamant: { up: "atk", down: "spa" },
    Naughty: { up: "atk", down: "spd" },
    Bold: { up: "def", down: "atk" },
    Relaxed: { up: "def", down: "spe" },
    Impish: { up: "def", down: "spa" },
    Lax: { up: "def", down: "spd" },
    Timid: { up: "spe", down: "atk" },
    Hasty: { up: "spe", down: "def" },
    Jolly: { up: "spe", down: "spa" },
    Naive: { up: "spe", down: "spd" },
    Modest: { up: "spa", down: "atk" },
    Mild: { up: "spa", down: "def" },
    Quiet: { up: "spa", down: "spe" },
    Rash: { up: "spa", down: "spd" },
    Calm: { up: "spd", down: "atk" },
    Gentle: { up: "spd", down: "def" },
    Sassy: { up: "spd", down: "spe" },
    Careful: { up: "spd", down: "spa" }
  };

  const TYPE_KEYS = ["Normal","Fire","Water","Electric","Grass","Ice","Fighting","Poison","Ground","Flying","Psychic","Bug","Rock","Ghost","Dragon","Dark","Steel","Fairy"];

const TYPE_CHART = (function(){
  const T = {};
  const set = (atk, def, mult) => {
    if(!T[atk]) T[atk] = {};
    T[atk][def] = mult;
  };
  // default 1 assumed
  // Normal
  set("Normal","Rock",0.5); set("Normal","Ghost",0); set("Normal","Steel",0.5);
  // Fire
  ["Grass","Ice","Bug","Steel"].forEach(d=>set("Fire",d,2));
  ["Fire","Water","Rock","Dragon"].forEach(d=>set("Fire",d,0.5));
  // Water
  ["Fire","Ground","Rock"].forEach(d=>set("Water",d,2));
  ["Water","Grass","Dragon"].forEach(d=>set("Water",d,0.5));
  // Electric
  ["Water","Flying"].forEach(d=>set("Electric",d,2));
  ["Electric","Grass","Dragon"].forEach(d=>set("Electric",d,0.5));
  set("Electric","Ground",0);
  // Grass
  ["Water","Ground","Rock"].forEach(d=>set("Grass",d,2));
  ["Fire","Grass","Poison","Flying","Bug","Dragon","Steel"].forEach(d=>set("Grass",d,0.5));
  // Ice
  ["Grass","Ground","Flying","Dragon"].forEach(d=>set("Ice",d,2));
  ["Fire","Water","Ice","Steel"].forEach(d=>set("Ice",d,0.5));
  // Fighting
  ["Normal","Ice","Rock","Dark","Steel"].forEach(d=>set("Fighting",d,2));
  ["Poison","Flying","Psychic","Bug","Fairy"].forEach(d=>set("Fighting",d,0.5));
  set("Fighting","Ghost",0);
  // Poison
  ["Grass","Fairy"].forEach(d=>set("Poison",d,2));
  ["Poison","Ground","Rock","Ghost"].forEach(d=>set("Poison",d,0.5));
  set("Poison","Steel",0);
  // Ground
  ["Fire","Electric","Poison","Rock","Steel"].forEach(d=>set("Ground",d,2));
  ["Grass","Bug"].forEach(d=>set("Ground",d,0.5));
  set("Ground","Flying",0);
  // Flying
  ["Grass","Fighting","Bug"].forEach(d=>set("Flying",d,2));
  ["Electric","Rock","Steel"].forEach(d=>set("Flying",d,0.5));
  // Psychic
  ["Fighting","Poison"].forEach(d=>set("Psychic",d,2));
  ["Psychic","Steel"].forEach(d=>set("Psychic",d,0.5));
  set("Psychic","Dark",0);
  // Bug
  ["Grass","Psychic","Dark"].forEach(d=>set("Bug",d,2));
  ["Fire","Fighting","Poison","Flying","Ghost","Steel","Fairy"].forEach(d=>set("Bug",d,0.5));
  // Rock
  ["Fire","Ice","Flying","Bug"].forEach(d=>set("Rock",d,2));
  ["Fighting","Ground","Steel"].forEach(d=>set("Rock",d,0.5));
  // Ghost
  ["Psychic","Ghost"].forEach(d=>set("Ghost",d,2));
  ["Dark"].forEach(d=>set("Ghost",d,0.5));
  set("Ghost","Normal",0);
  // Dragon
  set("Dragon","Dragon",2);
  set("Dragon","Steel",0.5);
  set("Dragon","Fairy",0);
  // Dark
  ["Psychic","Ghost"].forEach(d=>set("Dark",d,2));
  ["Fighting","Dark","Fairy"].forEach(d=>set("Dark",d,0.5));
  // Steel
  ["Ice","Rock","Fairy"].forEach(d=>set("Steel",d,2));
  ["Fire","Water","Electric","Steel"].forEach(d=>set("Steel",d,0.5));
  // Fairy
  ["Fighting","Dragon","Dark"].forEach(d=>set("Fairy",d,2));
  ["Fire","Poison","Steel"].forEach(d=>set("Fairy",d,0.5));
  return T;
})();

function typeMult(atk, def){
  const a = String(atk || "");
  const d = String(def || "");
  return (TYPE_CHART[a] && TYPE_CHART[a][d] != null) ? TYPE_CHART[a][d] : 1;
}



async function loadAllData(){
  if(window.__PTD_ALL_DATA) return window.__PTD_ALL_DATA;
  const d = await loadPlannerData();
  window.__PTD_ALL_DATA = d;
  return d;
}

function defensiveProfile(types){
  const t = (Array.isArray(types) ? types : []).filter(Boolean).map(titleCaseName);
  const res = {};
  for(const atk of TYPE_KEYS){
    let m = 1;
    for(const def of t){
      m *= typeMult(atk, def);
    }
    res[atk] = m;
  }
  return res;
}

function offensiveProfile(moveTypes){
  const mts = (Array.isArray(moveTypes) ? moveTypes : []).filter(Boolean).map(titleCaseName);
  const res = {};
  for(const def of TYPE_KEYS){
    let best = 1;
    for(const atk of mts){
      const m = typeMult(atk, def);
      if(m > best) best = m;
    }
    res[def] = best;
  }
  return res;
}
function natureLabel(natureName){
    const n = String(natureName || "");
    const fx = NATURE_EFFECTS[n];
    if(!fx) return n ? `${n} (neutral)` : "";
    const up = fx.up ? fx.up.toUpperCase() : "";
    const down = fx.down ? fx.down.toUpperCase() : "";
    return `${n} (+${up}, -${down})`;
  }


  function natureMultiplier(natureName, statKey){
    const n = String(natureName || "").trim();
    const fx = NATURE_EFFECTS[n];
    if(!fx) return 1;
    if(fx.up === statKey) return 1.1;
    if(fx.down === statKey) return 0.9;
    return 1;
  }

  function calcFinalStats(base, ivs, evs, level, natureName){
    const L = clampInt(level, 1, 100);
    const out = {};

    const bHp = parseInt(base.hp, 10) || 0;
    const ivHp = clampInt(ivs.hp, 0, 31);
    const evHp = clampInt(evs.hp, 0, 252);
    out.hp = Math.floor(((2*bHp + ivHp + Math.floor(evHp/4)) * L) / 100) + L + 10;

    for(const k of ["atk","def","spa","spd","spe"]){
      const b = parseInt(base[k], 10) || 0;
      const iv = clampInt(ivs[k], 0, 31);
      const ev = clampInt(evs[k], 0, 252);
      const pre = Math.floor(((2*b + iv + Math.floor(ev/4)) * L) / 100) + 5;
      out[k] = Math.floor(pre * natureMultiplier(natureName, k));
    }

    return out;
  }

  async function initPlannerPage(){
    migrateOldTeamsIfNeeded();

    const teamSelect = byId("teamSelect");
    const teamName = byId("teamName");
    const saveTeamNameBtn = byId("saveTeamNameBtn");
    const grid = byId("plannerGrid");
    const status = byId("plannerStatus");
    const dataPill = byId("dataPill");
    const itemsDatalist = byId("itemsDatalist");

    const teams = getSavedTeams();
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("team");

    if(!teams.length){
      status.textContent = "No saved teams yet. Draft and save a team first.";
      teamSelect.innerHTML = `<option value="">No teams</option>`;
      grid.innerHTML = "";
      dataPill.textContent = "No data";
      return;
    }

    teamSelect.innerHTML = teams.map(t => {
      const sel = t.id === wanted ? "selected" : "";
      return `<option value="${escapeHtml(t.id)}" ${sel}>${escapeHtml(t.name || "Untitled team")}</option>`;
    }).join("");

    let data = null;
    try{
      data = await loadPlannerData();
      const hasPools = !!(data.levelUp && data.egg && data.tm && data.tutor);
      dataPill.textContent = hasPools ? "Loaded data and learnsets (filtered moves enabled)" : "Loaded data (learnset JSON missing, move filtering limited)";
      buildDatalistItems(itemsDatalist, data.itemNames);
    } catch(e){
      dataPill.textContent = "Failed to load /data files";
      status.textContent = String(e && e.message ? e.message : e);
    }

    function syncUrl(teamId){
      const u = new URL(window.location.href);
      u.searchParams.set("team", teamId);
      window.history.replaceState({}, "", u.toString());
    }

    function getSelectedTeam(){
      const id = teamSelect.value;
      return teams.find(t => t.id === id) || teams[0];
    }

    function ensurePlans(team){
  const plans = getPlans();
  const entry = plans[team.id] && typeof plans[team.id] === "object" ? plans[team.id] : {};
  for(const mon of (team.mons || [])){
    const key = mon && mon.speciesConst ? String(mon.speciesConst) : String(mon.name || "").toLowerCase();
    // migrate old key (name) -> new key (speciesConst)
    if(mon && mon.speciesConst){
      const oldKey = String(mon.name || "").toLowerCase();
      if(oldKey && entry[oldKey] && !entry[key]) entry[key] = entry[oldKey];
    }
    if(!entry[key]) entry[key] = defaultPlan();
  }
  plans[team.id] = entry;
  setPlans(plans);
  return entry;
}



    async function exportTeamToExcel(team){
      const exportBtn = byId("exportExcelBtn");
      if(exportBtn) exportBtn.disabled = true;
      try{
        const plansForTeam = ensurePlans(team);
        const rows = [];
        const header = [
          "Slot","Pokemon","Level","Nature","Ability","Item",
          "Move 1","Move 2","Move 3","Move 4",
          "EV HP","EV Atk","EV Def","EV SpA","EV SpD","EV Spe",
          "IV HP","IV Atk","IV Def","IV SpA","IV SpD","IV Spe",
          "Final HP","Final Atk","Final Def","Final SpA","Final SpD","Final Spe"
        ];
        rows.push(header);

        for(let i=0;i<6;i++){
          const teamArr = (team && Array.isArray(team.team)) ? team.team : ((team && Array.isArray(team.mons)) ? team.mons : []);
          const mon = teamArr[i];
          if(!mon || !mon.name){
            rows.push([i+1,"","","","","","","","","","","","","","","","","","","","","","","","","","",""]);
            continue;
          }
          const key = (mon && mon.speciesConst) ? String(mon.speciesConst) : String(mon.name || "").toLowerCase();
          const plan = plansForTeam[key] || defaultPlan();

          let base = null;
          try{
            const d = await getPokemonDetailsResolved(mon.name);
            const stats = Array.isArray(d.stats) ? d.stats : [];
            const byName = {};
            for(const s of stats){
              const n = s && s.stat && s.stat.name ? s.stat.name : "";
              const v = s && typeof s.base_stat === "number" ? s.base_stat : null;
              if(n && v != null) byName[n] = v;
            }
            base = {
              hp: byName.hp ?? 0,
              atk: byName.attack ?? 0,
              def: byName.defense ?? 0,
              spa: byName["special-attack"] ?? 0,
              spd: byName["special-defense"] ?? 0,
              spe: byName.speed ?? 0
            };
          } catch(e){
            base = { hp:0, atk:0, def:0, spa:0, spd:0, spe:0 };
          }

          const finalStats = calcFinalStats(
            base,
            plan.ivs || { hp:31, atk:31, def:31, spa:31, spd:31, spe:31 },
            plan.evs || { hp:0, atk:0, def:0, spa:0, spd:0, spe:0 },
            plan.level || 50,
            plan.nature || ""
          );

          rows.push([
            i+1,
            titleCaseName(mon.name),
            plan.level || 50,
            plan.nature || "",
            plan.ability || "",
            plan.item || "",
            plan.moves && plan.moves[0] ? plan.moves[0] : "",
            plan.moves && plan.moves[1] ? plan.moves[1] : "",
            plan.moves && plan.moves[2] ? plan.moves[2] : "",
            plan.moves && plan.moves[3] ? plan.moves[3] : "",
            plan.evs ? plan.evs.hp : 0,
            plan.evs ? plan.evs.atk : 0,
            plan.evs ? plan.evs.def : 0,
            plan.evs ? plan.evs.spa : 0,
            plan.evs ? plan.evs.spd : 0,
            plan.evs ? plan.evs.spe : 0,
            plan.ivs ? plan.ivs.hp : 31,
            plan.ivs ? plan.ivs.atk : 31,
            plan.ivs ? plan.ivs.def : 31,
            plan.ivs ? plan.ivs.spa : 31,
            plan.ivs ? plan.ivs.spd : 31,
            plan.ivs ? plan.ivs.spe : 31,
            finalStats.hp, finalStats.atk, finalStats.def, finalStats.spa, finalStats.spd, finalStats.spe
          ]);
        }

        const filename = (team.name ? team.name.replace(/[^a-z0-9 _-]+/gi,"").trim() : "team") || "team";
        if(typeof XLSX !== "undefined" && XLSX && XLSX.utils){
          const wb = XLSX.utils.book_new();
          const ws = XLSX.utils.aoa_to_sheet(rows);
          XLSX.utils.book_append_sheet(wb, ws, "Team");
          XLSX.writeFile(wb, filename + ".xlsx");
        } else {
          const csv = rows.map(r => r.map(v => {
            const s = String(v ?? "");
            if(/[",\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
            return s;
          }).join(",")).join("\n");
          const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = filename + ".csv";
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
        status.textContent = "Exported.";
      } finally {
        if(exportBtn) exportBtn.disabled = false;
      }
    }

    function savePlan(teamId, monKey, plan){
      const plans = getPlans();
      const t = plans[teamId] && typeof plans[teamId] === "object" ? plans[teamId] : {};
      t[monKey] = plan;
      plans[teamId] = t;
      setPlans(plans);
    }

    function monToConst(monName){
      if(!data) return null;
      const n = normalizeKey(titleCaseName(monName));
      return data.speciesNameToConst[n] || null;
    }

    function getMonData(monName){
      if(!data) return null;
      const c = monToConst(monName);
      if(!c) return null;
      const bs = data.baseStats[c];
      if(!bs || typeof bs !== "object") return { constName: c, base: null };
      return { constName: c, base: bs };
    }

    function abilityOptions(unb){
      if(!data || !unb || !unb.base) return [];
      const b = unb.base;
      const keys = [b.ability1, b.ability2, b.hiddenAbility].filter(Boolean);
      const names = keys.map(k => data.abilityNames[k]).filter(v => typeof v === "string" && v && v !== "-");
      return Array.from(new Set(names));
    }

    async function renderTeam(team){
      teamName.value = team.name || "";
      grid.innerHTML = `<div class="muted small">Loading...</div>`;

      const plansForTeam = ensurePlans(team);
      const mons = team.mons || [];
      grid.innerHTML = "";

      for(const mon of mons){
        const monKey = mon && mon.speciesConst ? String(mon.speciesConst) : String(mon.name || "").toLowerCase();
        const plan = plansForTeam[monKey] || defaultPlan();
        if(!plan.nature) plan.nature = data && data.naturesList.length ? data.naturesList[0] : "Hardy";
        if(!plan.movePool) plan.movePool = "all";

        const unb = getMonData(mon.name);
        const speciesConst = unb ? unb.constName : null;

        const abilities = unb ? abilityOptions(unb) : [];
        let types = (unb && unb.base && data)
          ? [data.typeNames[unb.base.type1], data.typeNames[unb.base.type2]].filter(t => t && t !== "None")
          : (mon.types || []).map(titleCaseName);
        {
          const seen = new Set();
          const out = [];
          for(const t of types){
            const k = String(t).toLowerCase();
            if(!k) continue;
            if(seen.has(k)) continue;
            seen.add(k);
            out.push(t);
          }
          types = out;
        }

        const baseStats = (unb && unb.base) ? {
          hp: unb.base.baseHP,
          atk: unb.base.baseAttack,
          def: unb.base.baseDefense,
          spa: unb.base.baseSpAttack,
          spd: unb.base.baseSpDefense,
          spe: unb.base.baseSpeed
        } : { hp:"-", atk:"-", def:"-", spa:"-", spd:"-", spe:"-" };

        let eggRootConst = null;

        if(data && speciesConst && mon && mon.name && data.egg && !data.egg[speciesConst]){
          getEggRootConstForApiName(mon.name, data).then(c => {
            eggRootConst = c;
            fillMoves();
          }).catch(()=>{});
        }

        const card = document.createElement("section");
        card.className = "monCard";

        const poolsAvailable = !!(data && data.levelUp && data.egg && data.tm && data.tutor && speciesConst);

        card.innerHTML = `
          <div class="monHead">
            <div class="monHeadLeft">
              <img class="miniSprite" src="${mon.sprite || ""}" alt="">
              <div>
                <div class="monName">${escapeHtml(titleCaseName(mon.name))}</div>
                <div class="monMeta">#${String(mon.id || "").padStart(3,"0")} · ${escapeHtml(types.length ? types.join(" / ") : "-")}</div>
              </div>
            </div>
            <div class="badge">${escapeHtml(unb && unb.base ? "Unbound stats" : "No Unbound match")}</div>
          </div>

          <details class="monDetails" open><summary class="monSummary">Details</summary><div class="monBody">
            <div class="cols2">
              <label class="field">
                <span class="label">Ability</span>
                <select class="input" data-k="ability"></select>
              </label>
              <label class="field">
                <span class="label">Item</span>
                <input class="input" data-k="item" list="itemsDatalist" placeholder="Item name">
              </label>
            </div>

            <div class="cols2">
              <label class="field">
                <span class="label">Nature</span>
                <select class="input" data-k="nature"></select>
              </label>
              <label class="field">
                <span class="label">Level</span>
                <input class="input" type="number" min="1" max="100" data-k="level" value="${escapeHtml(String(plan.level))}">
              </label>
            </div>

            <div class="cols2">
              <label class="field">
                <span class="label">Move pool</span>
                <select class="input" data-k="movePool" ${poolsAvailable ? "" : "disabled"}></select>
              </label>
              <div class="field grow">
                <span class="label">&nbsp;</span>
                <div class="pill">${escapeHtml(poolsAvailable ? "Filtered to learnable moves" : "Learnset JSON missing or species not matched")}</div>
              </div>
            </div>

            <div class="hr"></div>

            <div class="sectionTitle">Moves</div>
            <div class="cols2">
              ${[0,1,2,3].map(i => `
                <label class="field">
                  <span class="label">Move ${i+1}</span>
                  <select class="input" data-move="${i}"></select>
                  <div class="muted small" data-moveinfo="${i}"></div>
                </label>
              `).join("")}
            </div>

            <div class="hr"></div>

            <div class="sectionTitle">Base stats</div>
            <div class="statGrid">
              ${[
                ["HP","hp"],["Atk","atk"],["Def","def"],
                ["SpA","spa"],["SpD","spd"],["Spe","spe"]
              ].map(([label,k]) => `
                <div class="genToggle">
                  <span>${label}</span>
                  <span>${escapeHtml(String(baseStats[k]))}</span>
                </div>
              `).join("")}
            </div>

            <div class="sectionTitle">Final stats</div>
            <div class="statGrid">
              ${[
                ["HP","hp"],["Atk","atk"],["Def","def"],
                ["SpA","spa"],["SpD","spd"],["Spe","spe"]
              ].map(([label,k]) => `
                <div class="genToggle">
                  <span>${label}</span>
                  <span data-finalstat="${k}">-</span>
                </div>
              `).join("")}
            </div>

<div class="sectionTitle">EVs</div>
            <div class="statGrid">
              ${["hp","atk","def","spa","spd","spe"].map(k => `
                <label class="field" style="min-width:0">
                  <span class="label">${k.toUpperCase()}</span>
                  <input class="input" type="number" min="0" max="252" step="4" data-ev="${k}" value="${escapeHtml(String(plan.evs[k]))}">
                </label>
              `).join("")}
            </div>

            <div class="sectionTitle">IVs</div>
            <div class="statGrid">
              ${["hp","atk","def","spa","spd","spe"].map(k => `
                <label class="field" style="min-width:0">
                  <span class="label">${k.toUpperCase()}</span>
                  <input class="input" type="number" min="0" max="31" data-iv="${k}" value="${escapeHtml(String(plan.ivs[k]))}">
                </label>
              `).join("")}
            </div>

            <label class="field">
              <span class="label">Notes</span>
              <textarea class="input note" data-k="notes" placeholder="Role, matchups, calc notes...">${escapeHtml(plan.notes || "")}</textarea>
            </label>
          </div>
        `;

        const abilitySel = card.querySelector('[data-k="ability"]');
        const itemInput = card.querySelector('[data-k="item"]');
        const natureSel = card.querySelector('[data-k="nature"]');
        const poolSel = card.querySelector('[data-k="movePool"]');

        const abOpts = ["", ...abilities];
        abilitySel.innerHTML = abOpts.map(a => {
          const sel = (plan.ability || "") === a ? "selected" : "";
          return `<option value="${escapeHtml(a)}" ${sel}>${escapeHtml(a || "Select ability")}</option>`;
        }).join("");
        itemInput.value = plan.item || "";

        const natures = data && data.naturesList.length ? data.naturesList : ["Hardy"];
        natureSel.innerHTML = natures.map(n => {
          const sel = plan.nature === n ? "selected" : "";
          return `<option value="${escapeHtml(n)}" ${sel}>${escapeHtml(natureLabel(n))}</option>`;
        }).join("");

        const poolOptions = [
          ["all","All"],
          ["level","Level up"],
          ["tm","TM"],
          ["tutor","Tutor"],
          ["egg","Egg"]
        ];
        poolSel.innerHTML = poolOptions.map(([v,lab]) => {
          const sel = plan.movePool === v ? "selected" : "";
          return `<option value="${escapeHtml(v)}" ${sel}>${escapeHtml(lab)}</option>`;
        }).join("");

        const fillMoves = async () => {
          let list = [];
          const want = plan.movePool || "all";

          if(data && speciesConst){
            list = poolForSpecies(data, speciesConst, want, eggRootConst);
          }

          // Always merge in PokeAPI moves so egg moves and alternate forms are covered.
          try{
            const apiPools = await getApiMovePools(mon.name);
            const apiList = (want === "level") ? apiPools.level
                         : (want === "egg") ? apiPools.egg
                         : (want === "tm") ? apiPools.tm
                         : (want === "tutor") ? apiPools.tutor
                         : apiPools.all;

            if(list && list.length){
              // Only merge egg moves into the local "all" and "egg" pools to avoid bloating other pools.
              if(want === "all" || want === "egg"){
                list = uniqStrings([ ...list, ...apiPools.egg ]);
              }
            } else {
              list = apiList;
            }
          } catch(e){
            // ignore
          }

          const opts = ["", ...(list || [])];

          const moveSelects = Array.from(card.querySelectorAll("[data-move]"));
          moveSelects.forEach(selEl => {
            const i = parseInt(selEl.getAttribute("data-move"), 10);
            const cur = plan.moves[i] || "";
            selEl.innerHTML = opts.map(mv => {
              const sel = cur === mv ? "selected" : "";
              return `<option value="${escapeHtml(mv)}" ${sel}>${escapeHtml(mv || "Select move")}</option>`;
            }).join("");

            const infoEl = card.querySelector(`[data-moveinfo="${i}"]`);
            const updInfo = () => {
              const v = String(selEl.value || "").trim();
              if(!v || !data){
                infoEl.textContent = "";
                return;
              }
              const d = moveDetailsByName(data, v);
              if(!d){
                infoEl.textContent = "";
                return;
              }
              const bits = [];
              if(d.type) bits.push(d.type);
              if(d.split) bits.push(d.split);
              if(d.pp) bits.push(`PP ${d.pp}`);
              infoEl.textContent = bits.join(" · ");
            };
            updInfo();
            selEl.addEventListener("change", () => {
              plan.moves[i] = String(selEl.value || "").trim();
              savePlan(team.id, monKey, plan);
              updInfo();
              updateFinal();
            });
          });
        };

const updateFinal = () => {
          const out = (unb && unb.base)
            ? calcFinalStats(
                {
                  hp: unb.base.baseHP,
                  atk: unb.base.baseAttack,
                  def: unb.base.baseDefense,
                  spa: unb.base.baseSpAttack,
                  spd: unb.base.baseSpDefense,
                  spe: unb.base.baseSpeed
                },
                plan.ivs,
                plan.evs,
                plan.level,
                plan.nature
              )
            : null;

          for(const k of ["hp","atk","def","spa","spd","spe"]){
            const el = card.querySelector(`[data-finalstat="${k}"]`);
            if(!el) continue;
            el.textContent = out ? String(out[k]) : "-";
          }
        };

        fillMoves();
        updateFinal();

        card.addEventListener("change", (e) => {
          const t = e.target;
          if(!(t instanceof HTMLElement)) return;

          const k = t.getAttribute("data-k");
          if(k){
            if(k === "level") plan.level = clampInt(t.value, 1, 100);
            else plan[k] = t.value;
            if(k === "nature" || k === "level"){
              updateFinal();
            }
            if(k === "movePool"){
              for(let i = 0; i < 4; i++) plan.moves[i] = "";
              fillMoves();
            }
            savePlan(team.id, monKey, plan);
            return;
          }

          const mv = t.getAttribute("data-move");
          if(mv != null){
            const i = parseInt(mv, 10);
            plan.moves[i] = t.value || "";
            savePlan(team.id, monKey, plan);
            return;
          }

          const ev = t.getAttribute("data-ev");
          if(ev){
            const raw = clampInt(t.value, 0, 252);
            const snapped = Math.floor(raw / 4) * 4;
            plan.evs[ev] = snapped;

            const total = Object.values(plan.evs).reduce((a,b)=>a+(parseInt(b,10)||0),0);
            const cap = 510;
            if(total > cap){
              const over = total - cap;
              const reduced = Math.max(0, plan.evs[ev] - over);
              plan.evs[ev] = Math.floor(reduced / 4) * 4;
            }

            t.value = String(plan.evs[ev] || 0);
            updateFinal();
            savePlan(team.id, monKey, plan);
            return;
          }

          const iv = t.getAttribute("data-iv");
          if(iv){
            plan.ivs[iv] = clampInt(t.value, 0, 31);
            updateFinal();
            savePlan(team.id, monKey, plan);
          }
        });

        card.addEventListener("input", (e) => {
          const t = e.target;
          if(!(t instanceof HTMLElement)) return;

          const ev = t.getAttribute("data-ev");
          if(ev){
            const raw = clampInt(t.value, 0, 252);
            plan.evs[ev] = Math.floor(raw / 4) * 4;
            const total = Object.values(plan.evs).reduce((a,b)=>a+(parseInt(b,10)||0),0);
            const cap = 510;
            if(total > cap){
              const over = total - cap;
              plan.evs[ev] = Math.max(0, plan.evs[ev] - over);
              plan.evs[ev] = Math.floor(plan.evs[ev] / 4) * 4;
            }
            updateFinal();
            return;
          }

          const iv = t.getAttribute("data-iv");
          if(iv){
            plan.ivs[iv] = clampInt(t.value, 0, 31);
            updateFinal();
            return;
          }

          const k = t.getAttribute("data-k");
          if(k === "notes"){
            plan.notes = t.value || "";
            savePlan(team.id, monKey, plan);
          }
          if(k === "level"){
            plan.level = clampInt(t.value, 1, 100);
            updateFinal();
          }
        });

        grid.appendChild(card);
      }

// Team coverage summary

    }

    saveTeamNameBtn.addEventListener("click", () => {
      const id = teamSelect.value;
      const teamsNow = getSavedTeams();
      const t = teamsNow.find(x => x.id === id);
      if(!t) return;
      const name = String(teamName.value || "").trim() || "Untitled team";
      t.name = name;
      upsertTeam(t);
      status.textContent = "Saved team name.";
      const fresh = getSavedTeams();
      teamSelect.innerHTML = fresh.map(tt => {
        const sel = tt.id === id ? "selected" : "";
        return `<option value="${escapeHtml(tt.id)}" ${sel}>${escapeHtml(tt.name || "Untitled team")}</option>`;
      }).join("");
    });

    teamSelect.addEventListener("change", async () => {
      const t = getSelectedTeam();
      syncUrl(t.id);
      await renderTeam(t);
    });

    const exportExcelBtn = byId("exportExcelBtn");
    if(exportExcelBtn){
      exportExcelBtn.addEventListener("click", async () => {
        const t = getSelectedTeam();
        await exportTeamToExcel(t);
      });
    }

    const initial = getSelectedTeam();
    syncUrl(initial.id);
    await renderTeam(initial);
  }

  
  async function initCompendiumPage(){
    const tabs = byId("compendiumTabs");
    const search = byId("compendiumSearch");
    const listEl = byId("compendiumList");
    const detailEl = byId("compendiumDetail");
    const status = byId("compendiumStatus");
    if(!tabs || !search || !listEl || !detailEl) return;

    status.textContent = "Loading...";
    let data = null;
    try{
      data = await loadPlannerData();
    } catch(e){
      status.textContent = "Failed to load local name lists.";
      return;
    }

    const moveLabels = Object.values(data.moveNames || {}).filter(v => typeof v === "string" && v && v !== "-");
    const abilityLabels = Object.values(data.abilityNames || {}).filter(v => typeof v === "string" && v && v !== "-");
    const itemLabels = Object.values(data.itemNames || {}).map(v => (typeof v === "string" ? v : (v && typeof v === "object" ? v.name : ""))).filter(v => typeof v === "string" && v && v !== "-");

    const slugify = (label) => {
      return String(label || "")
        .toLowerCase()
        .replace(/['’]/g,"")
        .replace(/[^a-z0-9]+/g,"-")
        .replace(/^-+|-+$/g,"")
        .replace(/-+/g,"-");
    };

    const cache = new Map();

    let _overridesPromise = null;
    async function loadUnboundOverrides(){
      if(_overridesPromise) return _overridesPromise;
      _overridesPromise = (async () => {
        try{
          return await fetchJson("data/UnboundTextOverrides.json");
        } catch(e){
          return { abilities: {}, items: {}, moves: {} };
        }
      })();
      return _overridesPromise;
    }


    async function fetchApi(kind, slug){
      const key = kind + ":" + slug;
      if(cache.has(key)) return cache.get(key);
      try{
        const j = await fetchJson(`${API.base}/${kind}/${encodeURIComponent(slug)}/`);
        cache.set(key, j);
        return j;
      } catch(e){
        cache.set(key, null);
        return null;
      }
    }

    const state = { tab: "moves", q: "", selected: null };

    function setTab(t){
      state.tab = t;
      state.selected = null;
      for(const b of tabs.querySelectorAll(".segBtn")){
        b.classList.toggle("on", b.getAttribute("data-tab") === t);
      }
      renderList();
      renderDetail(null);
    }

    async function renderDetail(payload, ctx){
      if(!payload){
        const tabNow = state.tab;
        const kindNow = (ctx && ctx.kind) ? ctx.kind : (tabNow === "moves" ? "move" : tabNow === "abilities" ? "ability" : "item");
        const slugNow = (ctx && ctx.slug) ? String(ctx.slug) : "";
        const nameNow = (ctx && ctx.label) ? String(ctx.label) : (slugNow ? titleCaseName(slugNow) : "Unknown");
        let descNow = "";
        try{
          const ovNow = await loadUnboundOverrides();
          const bucketNow = kindNow === "ability" ? (ovNow.abilities || {}) : kindNow === "move" ? (ovNow.moves || {}) : (ovNow.items || {});
          const entryNow = slugNow && bucketNow ? bucketNow[slugNow] : null;
          if(entryNow && entryNow.description) descNow = String(entryNow.description).trim();
        } catch(e){}
        if(descNow){
          detailEl.innerHTML = `<h3>${escapeHtml(nameNow)}</h3><div class="muted small">${escapeHtml(descNow)}</div>`;
        } else {
          detailEl.innerHTML = `<div class="muted small">Select an entry to see details.</div>`;
        }
        return;
      }

      const tab = state.tab;
      const name = (ctx && ctx.label) ? String(ctx.label) : (payload.name ? titleCaseName(payload.name) : "Unknown");
      const pickEnglishText = (p, kind) => {
        if(!p) return "";
        const isEn = (e) => e && e.language && e.language.name === "en";

        const eff = Array.isArray(p.effect_entries) ? p.effect_entries : [];
        const flav = Array.isArray(p.flavor_text_entries) ? p.flavor_text_entries : [];

        // Items: effect_entries is preferred, but some responses can have empty effect_entries.
        // Always fall back to flavor_text_entries if effect text is missing.
        if(kind === "item"){
          const e1 = eff.find(e => isEn(e) && (e.short_effect || e.effect));
          if(e1) return String(e1.short_effect || e1.effect || "").trim();

          const e2 = flav.find(e => isEn(e) && e.flavor_text);
          if(e2) return String(e2.flavor_text || "").trim();
        }

        // Abilities and moves
        const e3 = eff.find(e => isEn(e) && (e.short_effect || e.effect));
        if(e3) return String(e3.short_effect || e3.effect || "").trim();

        const e4 = flav.find(e => isEn(e) && e.flavor_text);
        if(e4) return String(e4.flavor_text || "").trim();

        // Last resort: any language entry that has text.
        const any = [...eff, ...flav].find(e => e && (e.short_effect || e.effect || e.flavor_text));
        return any ? String(any.short_effect || any.effect || any.flavor_text || "").trim() : "";
      };

      const kind = (ctx && ctx.kind) ? ctx.kind : (tab === "moves" ? "move" : tab === "abilities" ? "ability" : "item");
      const slug = (ctx && ctx.slug) ? ctx.slug : (payload && payload.name ? payload.name : "");
      let desc = pickEnglishText(payload, kind === "item" ? "item" : kind === "move" ? "move" : "ability");
      const ov = await loadUnboundOverrides();
      const ovBucket = kind === "ability" ? (ov.abilities || {}) : kind === "move" ? (ov.moves || {}) : (ov.items || {});
      const ovEntry = slug && ovBucket ? ovBucket[String(slug)] : null;
      if((!desc || !String(desc).trim()) && ovEntry && ovEntry.description){ desc = String(ovEntry.description).trim(); }

      if(tab === "moves"){
        const meta = [
          ["Type", payload.type && payload.type.name ? titleCaseName(payload.type.name) : "-"],
          ["Damage class", payload.damage_class && payload.damage_class.name ? titleCaseName(payload.damage_class.name) : "-"],
          ["Power", payload.power == null ? "-" : String(payload.power)],
          ["Accuracy", payload.accuracy == null ? "-" : String(payload.accuracy)],
          ["PP", payload.pp == null ? "-" : String(payload.pp)],
          ["Priority", payload.priority == null ? "-" : String(payload.priority)],
          ["Effect chance", payload.effect_chance == null ? "-" : String(payload.effect_chance)]
        ];
        detailEl.innerHTML = `
          <h3>${escapeHtml(name)}</h3>
          <div class="muted small" style="white-space:pre-wrap">${escapeHtml(desc)}</div>
          <div style="height:10px"></div>
          <div class="kv">
            ${meta.map(([k,v]) => `<div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(v)}</div>`).join("")}
          </div>
        `;
        return;
      }

      if(tab === "abilities"){
        const meta = [
          ["Generation", payload.generation && payload.generation.name ? titleCaseName(payload.generation.name) : "-"],
          ["Main series", payload.is_main_series ? "Yes" : "No"]
        ];
        detailEl.innerHTML = `
          <h3>${escapeHtml(name)}</h3>
          <div class="muted small" style="white-space:pre-wrap">${escapeHtml(desc)}</div>
          <div style="height:10px"></div>
          <div class="kv">
            ${meta.map(([k,v]) => `<div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(v)}</div>`).join("")}
          </div>
        `;
        return;
      }

      if(tab === "items"){
        const meta = [
          ["Category", payload.category && payload.category.name ? titleCaseName(payload.category.name) : "-"],
          ["Cost", payload.cost == null ? "-" : String(payload.cost)]
        ];
        detailEl.innerHTML = `
          <h3>${escapeHtml(name)}</h3>
          <div class="muted small" style="white-space:pre-wrap">${escapeHtml(desc)}</div>
          <div style="height:10px"></div>
          <div class="kv">
            ${meta.map(([k,v]) => `<div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(v)}</div>`).join("")}
          </div>
        `;
        return;
      }
    }

    function currentLabels(){
      if(state.tab === "moves") return moveLabels;
      if(state.tab === "abilities") return abilityLabels;
      return itemLabels;
    }

    async function selectLabel(label){
      state.selected = label;
      const slug = slugify(label);

      listEl.querySelectorAll(".compItem").forEach(el => {
        el.classList.toggle("on", el.getAttribute("data-label") === label);
      });

      detailEl.innerHTML = `<div class="muted small">Loading...</div>`;
      const kind = state.tab === "moves" ? "move" : state.tab === "abilities" ? "ability" : "item";
      const payload = await fetchApi(kind, slug);
      if(!payload){
        detailEl.innerHTML = `<div class="muted small">No PokeAPI entry found for "${escapeHtml(label)}".</div>`;
        return;
      }
      renderDetail(payload);
    }

    function renderList(){
      const q = normalizeKey(state.q);
      const labels = currentLabels()
        .filter(l => !q || normalizeKey(l).includes(q))
        .sort((a,b)=>a.localeCompare(b));

      listEl.innerHTML = labels.slice(0, 500).map(l => `<div class="compItem" data-label="${escapeHtml(l)}">${escapeHtml(l)}</div>`).join("");
      if(labels.length > 500){
        listEl.insertAdjacentHTML("beforeend", `<div class="muted small" style="padding:10px 12px">Showing first 500 matches. Narrow your search.</div>`);
      }
      listEl.querySelectorAll(".compItem").forEach(el => {
        el.addEventListener("click", () => selectLabel(el.getAttribute("data-label")));
      });
    }

    tabs.addEventListener("click", (e) => {
      const b = e.target && e.target.closest ? e.target.closest(".segBtn") : null;
      if(!b) return;
      const t = b.getAttribute("data-tab");
      if(t) setTab(t);
    });

    search.addEventListener("input", () => {
      state.q = search.value || "";
      renderList();
    });

    status.textContent = "Loaded.";
    setTab("moves");
  }



function initCoveragePage(){
  const sel = byId("coverageTeamSelect");
  const status = byId("coverageStatus");
  const monList = byId("coverageMonList");
  const teamDef = byId("teamDefGrid");
  const chart = byId("typeChart");
  let data = null;

  if(!sel || !status || !monList || !teamDef || !chart) return;

  const ensurePlansLocal = (team) => {
    const all = getPlans();
    const existing = (all[team.id] && typeof all[team.id] === "object") ? all[team.id] : {};
    const out = Object.assign({}, existing);
    let changed = false;

    for(const mon of (team.mons || [])){
      const key = (mon && mon.speciesConst) ? String(mon.speciesConst) : String(mon && mon.name ? mon.name : "").toLowerCase();
      if(!key) continue;
      if(!out[key] || typeof out[key] !== "object"){
        out[key] = defaultPlan();
        changed = true;
      } else {
        out[key] = Object.assign({}, defaultPlan(), out[key]);
      }
    }

    if(changed){
      all[team.id] = out;
      setPlans(all);
    }
    return out;
  };


  const renderTypeChart = () => {
    const head = '<div class="typeChart">' +
      '<div class="tcCorner"></div>' +
      TYPE_KEYS.map(t => '<div class="tcHead">' + escapeHtml(t) + '</div>').join('') +
      TYPE_KEYS.map(atk => {
        const row = '<div class="tcSide">' + escapeHtml(atk) + '</div>' +
          TYPE_KEYS.map(def => {
            const m = TYPE_CHART[atk] && TYPE_CHART[atk][def] != null ? TYPE_CHART[atk][def] : 1;
            const cls = m === 0 ? 'x0' : (m >= 4 ? 'x4' : (m >= 2 ? 'x2' : (m <= 0.25 ? 'x025' : (m <= 0.5 ? 'x05' : 'x1'))));
            return '<div class="tcCell ' + cls + '">' + escapeHtml(String(m)) + '</div>';
          }).join('');
        return row;
      }).join('') +
    '</div>';
    chart.innerHTML = head;
  };

  const renderProfile = (root, prof, mode) => {
    root.innerHTML = TYPE_KEYS.map(t => {
      const m = prof[t];
      const cls = m === 0 ? 'x0' : (m >= 4 ? 'x4' : (m >= 2 ? 'x2' : (m <= 0.25 ? 'x025' : (m < 1 ? 'x05' : 'x1'))));
      const label = (m === 1) ? 'x1' : (m === 0 ? 'x0' : ('x' + String(m)));
      return '<div class="typeCell ' + cls + '"><span class="typeName">' + escapeHtml(t) + '</span><span class="typeMult">' + escapeHtml(label) + '</span></div>';
    }).join('');
  };

  const renderTeam = (team, plans, data) => {
    monList.innerHTML = '';

    const defBest = {}; const defWeak = {}; const defResist = {};
    for(const t of TYPE_KEYS){ defBest[t] = 0; defWeak[t] = 0; defResist[t] = 0; }

    for(const mon of (team.mons || [])){
      const monKey = mon && mon.speciesConst ? String(mon.speciesConst) : String(mon.name || '').toLowerCase();
      const plan = (plans && plans[monKey]) ? plans[monKey] : defaultPlan();

      let types = (mon.types || []).map(titleCaseName);
      if(data){
        const c = mon && mon.speciesConst ? String(mon.speciesConst) : null;
        const bs = c && data.baseStats ? data.baseStats[c] : null;
        if(bs){
          const t1 = data.typeNames && data.typeNames[bs.type1] ? data.typeNames[bs.type1] : null;
          const t2 = data.typeNames && data.typeNames[bs.type2] ? data.typeNames[bs.type2] : null;
          types = [t1, t2].filter(t => t && t !== 'None');
        }
      }

      // De-duplicate monotype cases where type2 is incorrectly set to type1
      {
        const seen = new Set();
        const out = [];
        for(const t of types){
          const k = String(t).toLowerCase();
          if(!k) continue;
          if(seen.has(k)) continue;
          seen.add(k);
          out.push(t);
        }
        types = out;
      }

      const defProf = defensiveProfile(types);
      for(const t of TYPE_KEYS){
        const m = defProf[t];
        if(m > defBest[t]) defBest[t] = m;
        if(m >= 2) defWeak[t] += 1;
        if(m > 0 && m < 1) defResist[t] += 1;
      }

      const details = document.createElement('details');
      details.className = 'monDetails';
      details.innerHTML =
        '<summary class="monSummary">' +
          '<span class="monSumName">' + escapeHtml(titleCaseName(mon.name)) + '</span>' +
          '<span class="monSumTypes muted small">' + escapeHtml(types.length ? types.join(' / ') : '-') + '</span>' +
        '</summary>' +
        '<div class="monBody">' +
          '<div class="muted small" style="margin-bottom:8px">Defense multipliers</div>' +
          '<div class="typeGrid roomy" data-def></div>' +
        '</div>';
      monList.appendChild(details);
      renderProfile(details.querySelector('[data-def]'), defProf, 'def');
    }

    teamDef.innerHTML = TYPE_KEYS.map(t => {
      const w = defWeak[t] || 0;
      const r = defResist[t] || 0;
      const wCls = w > 0 ? 'hiW' : '';
      const rCls = r > 0 ? 'hiR' : '';
      return '<div class="typeCell"><span class="typ ' + t + '">' + titleCaseName(t) + '</span><span class="typeMult"><span class="wr ' + wCls + '">W ' + w + '</span> · <span class="rr ' + rCls + '">R ' + r + '</span></span></div>';
    }).join('');

    // Offense intentionally omitted on Coverage page.
  };

  (async () => {
    status.textContent = 'Loading data...';
    data = await loadAllData();
    renderTypeChart();

    const teams = getSavedTeams();
    if(!teams.length){
      status.textContent = 'No saved teams yet.';
      sel.innerHTML = '';
      monList.innerHTML = '<div class="muted small">Create a team in Drafter first.</div>';
      return;
    }

    sel.innerHTML = teams.map(t => '<option value="' + escapeHtml(String(t.id)) + '">' + escapeHtml(t.name || ('Team ' + t.id)) + '</option>').join('');

    const show = () => {
      const id = sel.value;
      const team = teams.find(t => String(t.id) === String(id)) || teams[0];
      const plans = ensurePlansLocal(team);
      renderTeam(team, plans, data);
      status.textContent = 'Showing ' + (team.name || ('Team ' + team.id)) + '.';
    };

    sel.addEventListener('change', show);
    show();
  })().catch(e => { status.textContent = 'Failed to load.'; console.error(e); });
}


window.PTD = { initDrafter, initTeamsPage, initPlannerPage, initCoveragePage, initCompendiumPage };
})();
