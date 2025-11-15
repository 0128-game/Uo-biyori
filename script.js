/*
 * 最終修正版: 魚種フィルターを厳密なAND条件 (b ⊆ a) に変更 ＋ カスタム入力欄対応
 * ＋ 絞り込みフィルターを「下処理 (pre)」アイテムにも適用
 *季節のフィルター動作
 *絞り込み完成
 */

(function(){
const tryPaths = [
    'docs/recipes.json',
    './docs/recipes.json',
    '/recipes.json',
    './recipes.json'
];

// ★★★ リスト/フィルター関連の要素 (既存のHTML要素を使用) ★★★
const wrap = document.getElementById('wrap');
const tbody = document.getElementById('tbody');
const qInput = document.getElementById('q');
const filterType = document.getElementById('filterType');
const sortBy = document.getElementById('sortBy');
const reloadBtn = document.getElementById('reloadBtn');
const message = document.getElementById('message');

// ★★★ 新しいフィルターモーダル関連の要素 (HTMLへの追加が必要です) ★★★
const filterOpenBtn = document.getElementById('filterOpenBtn'); 
const filterModal = document.getElementById('filterModal');     
const filterContent = document.getElementById('filterContent'); 
const applyFilterBtn = document.getElementById('applyFilterBtn'); 
const filterClearBtn = document.getElementById('filterClearBtn'); 

// ★★★ 詳細コンテナの要素 ★★★
const detailTitle = document.getElementById('detailTitle');
const detailSubtitle = document.getElementById('detailSubtitle');
const detailImageContainer = document.getElementById('detailImageContainer');
const detailMeta = document.getElementById('detailMeta');
const detailIngredients = document.getElementById('detailIngredients');
const detailRecipe = document.getElementById('detailRecipe');
const detailMemo = document.getElementById('detailMemo');
const backToListBtn = document.getElementById('backToListBtn');
const detailProps = document.getElementById('detailProps');
const propsSection = document.getElementById('propsSection');

let rawData = null;
let flatList = []; // merged list with type annotation

// フィルタの状態を保持するオブジェクト (魚種はSet、難易度/時間/費用は単一の値)
let activeFilters = {
    "fish-name": new Set(),      // チェックボックス形式 (複数選択)
    difficulty: null,            // ラジオボタン形式 (単一値)
    time: null,                  // ラジオボタン/入力形式 (単一値)
    cost: null,                  // ラジオボタン/入力形式 (単一値)
    selectedSeasons: new Set()   // 季節のチェックボックス (複数選択)
};


// 固定オプション
const DIFFICULTY_OPTIONS = ['1', '2', '3', '4', '5'];
const TIME_OPTIONS = [15, 30, 60]; 
const COST_OPTIONS = [500, 1000, 2000];
const TIME_MAX = 120; // 入力欄の最大値
const COST_MAX = 5000; // 入力欄の最大値

// 例: レシピ提案実行時
let tieBreaker = document.querySelector('input[name="tieBreaker"]:checked').value;

window.proposalModal = document.getElementById('proposalModal');

// Utility: safe text node creation
function elText(tag, text, cls){
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    el.textContent = (text === undefined || text === null) ? '' : String(text);
    return el;
}

// 複数パスから最初に成功する JSON を取得
async function fetchAny(paths){
    for (const path of paths){
        try {
            const res = await fetch(path, {cache: "no-store"});
            if (!res.ok) continue;
            const json = await res.json();
            return json;
        } catch(e){
            console.warn('fetch failed for', path, e);
        }
    }
    throw new Error('recipes.json を見つけられませんでした。期待する場所: ' + paths.join(', '));
}

// recipes + preparations を正規化してフラットリストを作成
function buildFlatList(data){
    let list = [];
    if (!data || typeof data !== 'object') return list;

    const recipes = data.recipes || {};
    for (const key of Object.keys(recipes)){
        const item = Object.assign({}, recipes[key]);
        item._type = 'recipe';
        item.No = item.No != null ? String(item.No) : String(key);
        item._origKey = key;
        list.push(item);
    }

    const pres = data.preparations || {};
    for (const key of Object.keys(pres)){
        const item = Object.assign({}, pres[key]);
        item._type = 'pre';
        item.No = item.No != null ? String(item.No) : String(key);
        item._origKey = key;
        list.push(item);
    }

    return list;
}

// 配列の値を文字列結合して表示用に変換
function joinIfArray(val){
    if (Array.isArray(val)) return val.join(', ');
    if (val === undefined || val === null) return '';
    return String(val);
}

// テーブルの内容をクリア
function clearTable(){ 
    if(tbody) tbody.innerHTML = ''; 
}




// 保存された設定内容
const savedFilters = {
    'fish-name': new Set(),
    difficulty: null,
    time: null,
    cost: null,
    seasonMode: 'none',
    season: new Set()
};



    
// --- モーダル初期化＆開く ---
function setupFilterModal(list) {
    initializeFilterModal(list);
    if (filterModal) filterModal.style.display = 'flex';
}

// --- 初期化処理 ---
function initializeFilterModal(list) {
    if (!filterContent) return;

    // --- 魚種チェックボックス ---
    const fishSet = new Set();
    list.forEach(item => {
        if (Array.isArray(item['fish-name'])) {
            item['fish-name'].forEach(f => {
                const trimmed = f.trim();
                if (trimmed) fishSet.add(trimmed);
            });
        }
    });
    const uniqueFish = Array.from(fishSet).sort();

    // フィールドセット作成
    let fishFieldset = document.getElementById('fishFilterFieldset');
    if (!fishFieldset) {
        fishFieldset = document.createElement('fieldset');
        fishFieldset.className = 'propose-group';
        fishFieldset.id = 'fishFilterFieldset';

        const legend = document.createElement('legend');
        legend.textContent = '魚種';
        fishFieldset.appendChild(legend);

        const gridRow = document.createElement('div');
        gridRow.className = 'grid-row';

        const gridLabel = document.createElement('div');
        gridLabel.className = 'grid-label';
        gridLabel.textContent = '種類';

        const gridControl = document.createElement('div');
        gridControl.className = 'grid-control';
        gridControl.id = 'fishCheckboxContainer';

        gridRow.appendChild(gridLabel);
        gridRow.appendChild(gridControl);
        fishFieldset.appendChild(gridRow);

        const firstFieldset = filterContent.querySelector('fieldset');
        filterContent.insertBefore(fishFieldset, firstFieldset);
    }

    // 中身をリセット
    const fishContainer = document.getElementById('fishCheckboxContainer');
    fishContainer.innerHTML = '';

    // 各魚をチェックボックスとして生成
    uniqueFish.forEach(fish => {
        const label = document.createElement('label');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.filterKey = 'fish-name';
        checkbox.value = fish;
        checkbox.checked = savedFilters['fish-name'].has(fish);

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(' ' + fish));
        fishContainer.appendChild(label);
    });

    // --- 難易度 ---
    const difficultyRadios = filterContent.querySelectorAll('input[name="difficulty"]');
    difficultyRadios.forEach(r => {
        const val = r.value === '' ? null : Number(r.value);
        r.checked = savedFilters.difficulty === val;
    });

    // --- 調理時間 ---
    const timeRadios = filterContent.querySelectorAll('input[name="time"]');
    const customTimeContainer = document.getElementById('customTimeInputContainer');
    const customTimeInput = document.getElementById('customTimeInput');

    let matchedTime = false;
    timeRadios.forEach(r => {
        const val = r.value === '' ? null : Number(r.value);
        r.checked = savedFilters.time === val;
        if (r.checked) matchedTime = true;
    });

    if (!matchedTime && savedFilters.time !== null) {
        customTimeContainer.style.display = '';
        customTimeInput.value = savedFilters.time;
        filterContent.querySelector('input[name="time"][value="custom"]').checked = true;
    } else {
        customTimeContainer.style.display = 'none';
        customTimeInput.value = '';
    }

    // --- 費用 ---
    const costRadios = filterContent.querySelectorAll('input[name="cost"]');
    const customCostContainer = document.getElementById('customCostInputContainer');
    const customCostInput = document.getElementById('customCostInput');

    let matchedCost = false;
    costRadios.forEach(r => {
        const val = r.value === '' ? null : Number(r.value);
        r.checked = savedFilters.cost === val;
        if (r.checked) matchedCost = true;
    });

    if (!matchedCost && savedFilters.cost !== null) {
        customCostContainer.style.display = '';
        customCostInput.value = savedFilters.cost;
        filterContent.querySelector('input[name="cost"][value="custom"]').checked = true;
    } else {
        customCostContainer.style.display = 'none';
        customCostInput.value = '';
    }

    // --- 季節 ---
    const seasonModeRadios = filterContent.querySelectorAll('input[name="filterSeasonMode"]');
    const seasonContainer = document.getElementById('seasonCheckboxContainer');
    seasonModeRadios.forEach(r => r.checked = (savedFilters.seasonMode === r.value));
    seasonContainer.style.display = (savedFilters.seasonMode === 'select') ? '' : 'none';
    const seasonCheckboxes = seasonContainer.querySelectorAll('input[name="filterSeason"]');
    seasonCheckboxes.forEach(cb => cb.checked = savedFilters.season.has(cb.value));

    // --- イベント登録 ---
    timeRadios.forEach(r => r.addEventListener('change', () => {
        customTimeContainer.style.display = (r.value === 'custom' && r.checked) ? '' : 'none';
        if (r.value !== 'custom') customTimeInput.value = '';
    }));

    costRadios.forEach(r => r.addEventListener('change', () => {
        customCostContainer.style.display = (r.value === 'custom' && r.checked) ? '' : 'none';
        if (r.value !== 'custom') customCostInput.value = '';
    }));

    seasonModeRadios.forEach(r => r.addEventListener('change', () => {
        seasonContainer.style.display = (r.value === 'select') ? '' : 'none';
        if (r.value !== 'select') seasonCheckboxes.forEach(cb => cb.checked = false);
    }));

    // --- 適用して閉じる ---
    const applyBtn = document.getElementById('applyFilterBtn');
    applyBtn.onclick = () => {
        saveCurrentFilters();
        updateActiveFilters();
        applyFiltersAndRender();
        if (filterModal) filterModal.style.display = 'none';
    };

    // --- 適用せずに閉じる ---
    const cancelBtn = document.getElementById('cancelFilterBtn');
    cancelBtn.onclick = () => {
        initializeFilterModal(list);
        if (filterModal) filterModal.style.display = 'none';
    };

    // --- ×ボタン ---
    const closeBtn = document.getElementById('closeFilterBtn');
    closeBtn.onclick = () => {
        initializeFilterModal(list);
        if (filterModal) filterModal.style.display = 'none';
    };
}



// --- 現在の設定内容を savedFilters に保存 ---
function saveCurrentFilters() {

    // --- 魚種 ---
    savedFilters['fish-name'].clear();
    filterContent.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
        if (cb.dataset.filterKey === 'fish-name') {
            savedFilters['fish-name'].add(cb.value);
        }
    });

    // --- 難易度・時間・費用 ---
    const filterKeys = ['difficulty', 'time', 'cost'];

    filterKeys.forEach(filterKey => {
        // 選択中のラジオボタンを取得
        const checkedRadio = filterContent.querySelector(`input[type="radio"][name="${filterKey}"]:checked`);

        if (!checkedRadio) return; // もし選択なしならスキップ

        if (checkedRadio.value === '') {
            // 制限なし
            activeFilters[filterKey] = null;
        } else if (checkedRadio.value === 'custom') {
            // カスタム入力
            const customInput = filterContent.querySelector(
                `input[type="number"][id="custom${filterKey.charAt(0).toUpperCase() + filterKey.slice(1)}Input"]`
            );
            if (customInput) {
                const val = parseFloat(customInput.value);
                if (!isNaN(val) && val > 0) {
                    activeFilters[filterKey] = String(val);
                } else {
                    // 入力が無効なら null に
                    activeFilters[filterKey] = null;
                }
            } else {
                // input が見つからなければ null
                activeFilters[filterKey] = null;
            }
        } else {
            // 通常のラジオ値
            activeFilters[filterKey] = checkedRadio.value;
        }
    });

    // --- 季節 ---
    const seasonModeChecked = filterContent.querySelector('input[name="filterSeasonMode"]:checked');
    savedFilters.seasonMode = seasonModeChecked ? seasonModeChecked.value : 'none';

    savedFilters.season.clear();
    if (savedFilters.seasonMode === 'select') {
        filterContent.querySelectorAll('input[name="filterSeason"]:checked').forEach(cb => savedFilters.season.add(cb.value));
    }


}



/**
 * activeFilters を更新
 */

function updateActiveFilters() {
    // --- 魚種 ---
    activeFilters['fish-name'].clear();
    filterContent.querySelectorAll('input[type="checkbox"]:checked').forEach(checkbox => {
        if (checkbox.dataset.filterKey === 'fish-name') {
            activeFilters['fish-name'].add(checkbox.value);
        }
    });

    // --- 難易度・時間・費用 ---
['difficulty', 'time', 'cost'].forEach(key => {
    activeFilters[key] = null;

    const checkedRadio = filterContent.querySelector(`input[type="radio"][name="${key}"]:checked`);
    if (checkedRadio) {
        if (checkedRadio.value === '') {
            activeFilters[key] = null;
        } else if (checkedRadio.value === 'custom') {
            const customInput = filterContent.querySelector(
                `input[type="number"][id="custom${key.charAt(0).toUpperCase() + key.slice(1)}Input"]`
            );
            if (customInput) {
                const val = parseFloat(customInput.value);
                if (!isNaN(val) && val > 0) {
                    activeFilters[key] = String(val);
                }
            }
        } else {
            activeFilters[key] = checkedRadio.value;
        }
    }
});


 // --- 季節 ---
// まずモードを取得
const seasonModeRadio = filterContent.querySelector('input[name="filterSeasonMode"]:checked');
activeFilters.seasonMode = seasonModeRadio ? seasonModeRadio.value : 'none';

// 選択モードならチェックされた季節を反映
activeFilters.selectedSeasons.clear();     // ← 修正ポイント

if (activeFilters.seasonMode === 'select') {
    const seasonCheckboxes = filterContent.querySelectorAll('input[name="filterSeason"]:checked');
    seasonCheckboxes.forEach(cb => {
        activeFilters.selectedSeasons.add(cb.value);  // ← 修正ポイント
    });
}

console.log(activeFilters);
}


    // 絞り込みここまで
    // render table rows from list
    function renderTable(list){
        clearTable();
        if (!tbody) return; 

        if (!Array.isArray(list) || list.length === 0){
            tbody.innerHTML = '<tr><td colspan="8" class="muted" style="padding:20px;text-align:center">表示するレシピがありません。</td></tr>';
            return;
        }
        const fragment = document.createDocumentFragment();
        for (const item of list){
            const tr = document.createElement('tr');

            // No
            const tdNo = document.createElement('td');
            tdNo.textContent = item.No || '-';
            tr.appendChild(tdNo);

            // Type
            const tdType = document.createElement('td');
            const span = document.createElement('span');
            span.className = 'tag-type ' + (item._type === 'pre' ? 'type-pre' : 'type-recipe');
            span.textContent = item._type;
            tdType.appendChild(span);
            tr.appendChild(tdType);

            // Picture
            const tdPicture = document.createElement('td');
            const img = document.createElement('img');
            img.className = 'recipe-thumb';
            const firstPic = (Array.isArray(item.pictures) && item.pictures.length > 0) ? item.pictures[0] : null;
            let imgSrc = firstPic && typeof firstPic === 'string' ? firstPic : 'https://0128-game.github.io/Fish-recipe/picture/noimage.png';
            img.src = imgSrc;
            img.alt = item.title || '画像';
            img.style.width = '80px'; 
            img.style.height = '60px'; 
            img.style.objectFit = 'cover'; 
            tdPicture.appendChild(img);
            tr.appendChild(tdPicture);

            // Title and flavortxt
            const tdTitle = document.createElement('td');
            const title = elText('div', item.title || '(タイトルなし)', ''); title.style.fontWeight='700';
            const flav = elText('div', item.flavortxt || '', 'muted');
            tdTitle.appendChild(title);
            tdTitle.appendChild(flav);
            tr.appendChild(tdTitle);

            // fish / season
            const tdFish = document.createElement('td');
            tdFish.appendChild(elText('div', joinIfArray(item['fish-name']) || '-', ''));
            tdFish.appendChild(elText('div', joinIfArray(item.season) || '', 'muted'));
            tr.appendChild(tdFish);

            // difficulty / time
            const tdDiff = document.createElement('td');
            tdDiff.appendChild(elText('div', '難易度: ' + (item.difficulty != null ? item.difficulty : '-')));
            tdDiff.appendChild(elText('div', '所要: ' + (item.time != null ? item.time + '分' : '-'), 'muted'));
            tr.appendChild(tdDiff);

            // cost / info line
            const tdCost = document.createElement('td');
            tdCost.appendChild(elText('div', '¥' + (item.cost != null ? item.cost : '-')));
            const infoLine = (item._type === 'recipe')
                ? ('食事: ' + (item.timing || '-'))
                : ('特徴: ' + joinIfArray(item.feature));
            tdCost.appendChild(elText('div', infoLine, 'muted'));
            tr.appendChild(tdCost);

            // actions
            const tdActions = document.createElement('td');
            tdActions.className = 'actions';

            // 詳細ボタン
            const viewBtn = document.createElement('button');
            viewBtn.textContent = '詳細';
            viewBtn.addEventListener('click', ()=> {
                displayDetail(item);
            });
            tdActions.appendChild(viewBtn);

            // 印刷ボタン
            const printBtn = document.createElement('button');
            printBtn.textContent = '印刷';
            printBtn.style.background = '#a0aec0'; 
            printBtn.addEventListener('click', ()=> {
                displayDetail(item);
                setTimeout(() => {
                    window.print();
                }, 500); 
            });
            tdActions.appendChild(printBtn);

            tr.appendChild(tdActions);
            fragment.appendChild(tr);
        }
        tbody.appendChild(fragment);
    }
    
    // Utility: 画像を表示するエレメントを作成する関数
    function createPictureElement(src, altText, maxHeight = '250px') {
        if (!src || src === 'null' || src === '') return null;

        const img = document.createElement('img');
        img.src = src;
        img.alt = altText || '画像';

        img.style.maxWidth = '100%';
        img.style.maxHeight = maxHeight;
        img.style.width = 'auto';
        img.style.objectFit = 'contain';
        img.style.borderRadius = '4px';
        img.style.display = 'block';
        img.style.margin = '0 auto';

        return img;
    }

    // 詳細情報を表示する関数
window.displayDetail = function(item){
        if(!detailTitle || !detailSubtitle || !detailMeta || !detailImageContainer || !detailIngredients || !detailRecipe || !detailMemo || !propsSection) {
            console.error("Missing detail element(s) in HTML.");
            return;
        }

        if (wrap) {
            wrap.classList.remove('list-view');
            wrap.classList.add('detail-view');
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });

        const pictures = item.pictures || [];
        const thumbPic = pictures[0] || 'https://0128-game.github.io/Fish-recipe/picture/noimage.png';

        detailTitle.textContent = (item.title || '(タイトルなし)') + ' — No.' + item.No;
        detailSubtitle.textContent = item.flavortxt || '';

        detailMeta.innerHTML = '';
        detailMeta.appendChild(elText('div', 'タイプ: ' + (item._type || '-'), 'pill'));
        detailMeta.appendChild(elText('div', '魚: ' + joinIfArray(item['fish-name']) , 'pill'));
        detailMeta.appendChild(elText('div', '旬: ' + joinIfArray(item.season), 'pill'));
        detailMeta.appendChild(elText('div', '難易度: ' + (item.difficulty != null ? item.difficulty : '-'), 'pill'));
        detailMeta.appendChild(elText('div', '費用: ' + (item.cost != null ? '¥' + item.cost : '-'), 'pill'));
        detailMeta.appendChild(elText('div', '所要時間: ' + (item.time != null ? item.time + '分' : '-'), 'pill'));

        if (item._type === 'recipe') {
            const preRecipeNo = item['pre-recipe'] ? String(item['pre-recipe']) : null;

            if (preRecipeNo) {
                const preItem = flatList.find(i => i._type === 'pre' && String(i.No) === preRecipeNo);

                if (preItem) {
                    const preBtn = document.createElement('button');
                    preBtn.textContent = '下処理: ' + (preItem.title || preItem.No); 
                    preBtn.className = 'pill pre-link-pill';
                    preBtn.style.cursor = 'pointer'; 

                    preBtn.addEventListener('click', ()=> displayDetail(preItem)); 
                    detailMeta.appendChild(preBtn);
                } else {
                    detailMeta.appendChild(elText('div', '下処理: No.' + preRecipeNo + ' (未発見)', 'pill'));
                }
            } else {
                 detailMeta.appendChild(elText('div', '下処理: なし', 'pill'));
            }
        } else if (item._type === 'pre') {
             detailMeta.appendChild(elText('div', '下処理', 'pill'));
        }

        detailImageContainer.innerHTML = '';
        const mainImg = createPictureElement(thumbPic, item.title, '250px');
        if (mainImg) {
            mainImg.style.border = '1px solid #ddd';
            mainImg.style.borderRadius = '8px';
            detailImageContainer.appendChild(mainImg);
        }

        detailIngredients.innerHTML = '';
        const ing = item.ingredients || {};

        if (Object.keys(ing).length === 0){
            detailIngredients.appendChild(elText('div','(材料なし)','muted'));
        } else {
            const ul = document.createElement('ul');
            for (const k of Object.keys(ing)){
                const li = document.createElement('li');
                li.textContent = k + ': ' + (ing[k] || '');
                ul.appendChild(li);
            }
            detailIngredients.appendChild(ul);
        }

        detailProps.innerHTML = '';
        const props = item.props || {};

        if (item._type === 'pre') {
            if (propsSection) propsSection.style.display = 'block';

            if (Object.keys(props).length === 0){
                detailProps.appendChild(elText('div', '(道具なし)', 'muted'));
            } else {
                const ul = document.createElement('ul');
                for (const k of Object.keys(props)){
                    const li = document.createElement('li');
                    li.textContent = props[k] || '';
                    ul.appendChild(li);
                }
                detailProps.appendChild(ul);
            }
        } else {
            if (propsSection) propsSection.style.display = 'none';
        }

        detailRecipe.innerHTML = '';
        const rec = item.recipe || [];

        if (!Array.isArray(rec) || rec.length === 0){
            detailRecipe.appendChild(elText('div','(手順なし)','muted'));
        } else {
            const gridContainer = document.createElement('div');
            gridContainer.style.display = 'grid';
            gridContainer.style.gridTemplateColumns = 'repeat(auto-fit, minmax(280px, 1fr))';
            gridContainer.style.gap = '10px';
            
            for (let i = 0; i < rec.length; i++){
                const step = rec[i];
                const stepNo = i + 1;

                const card = document.createElement('div');
                card.className = 'recipe-step-card'; 
                card.style.border = '1px solid #dee2e6'; 
                card.style.padding = '15px';
                card.style.borderRadius = '6px';
                card.style.background = 'var(--card)';
                card.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';

                const stepPicIndex = i + 1;
                const stepPicSrc = pictures[stepPicIndex];

                if (stepPicSrc && stepPicSrc !== 'null' && stepPicSrc !== '') {
                    const picContainer = document.createElement('div');
                    picContainer.className = 'recipe-step-picture';
                    const stepImg = createPictureElement(stepPicSrc, `手順${stepNo}の画像`, '150px');

                    if (stepImg) {
                        picContainer.appendChild(stepImg);
                        card.appendChild(picContainer);
                    }
                }

                const p = document.createElement('p');
                p.innerHTML = `<span style="font-weight:bold; color:var(--accent);">${stepNo}.</span> ${step}`;
                card.appendChild(p);

                gridContainer.appendChild(card);
            }
            
            detailRecipe.appendChild(gridContainer);
        }

        detailMemo.innerHTML = '';
        const memo = item.memo || [];
        if (!Array.isArray(memo) || memo.length === 0){
            detailMemo.appendChild(elText('div','(メモなし)','muted'));
        } else {
            const ulm = document.createElement('ul');
            for (const m of memo){
                ulm.appendChild(elText('li', m));
            }
            detailMemo.appendChild(ulm);
        }
if (window.proposalModal) proposalModal.style.display = 'none';

    }

/*hello*/
/**
 * フィルターを適用し、テーブルを再描画する
 */
function applyFiltersAndRender(){
    if(!qInput || !filterType || !sortBy || !message) { return; }

    const q = (qInput.value || '').trim().toLowerCase();
    const type = filterType.value;
    const sortVal = sortBy.value;

    let list = flatList.slice();

    // 1. タイプフィルター
    if(type !== 'all'){
        list = list.filter(i => i._type === type);
    }

    // 2. 検索フィルター
    if(q){
        list = list.filter(item => {
            const parts = [
                item.title, item.flavortxt,
                joinIfArray(item['fish-name']),
                joinIfArray(item.feature),
                joinIfArray(item.season),
                item.No,
                Object.keys(item.ingredients || {}).join(' '),
                joinIfArray(item.recipe),
                joinIfArray(item.memo),
                joinIfArray(item.props)
            ];
            const hay = parts.filter(Boolean).join(' ').toLowerCase();
            return hay.includes(q);
        });
    }

    // 3. 各種フィルター
    list = list.filter(item => {
        console.log("difficulty:", item.No, item.difficulty);
console.log("time:", item.No, item.time);
console.log("cost:", item.No, item.cost);

        // --- 魚種 ---
        const activeFish = activeFilters['fish-name'];
        const itemFish = Array.isArray(item['fish-name']) ? item['fish-name'].map(f=>f.trim()) : [];
        if(activeFish.size > 0){
            if(itemFish.length === 0 || !itemFish.every(f=>activeFish.has(f))){
                return false;
            }
        }

        // --- 難易度 ---
        const diff = Number(item.difficulty);
        if(activeFilters.difficulty != null && activeFilters.difficulty !== ''){
            if(isNaN(diff) || diff > Number(activeFilters.difficulty)){
                return false;
            }
        }

        // --- 時間 ---
        const time = Number(item.time);
        if(activeFilters.time != null && activeFilters.time !== ''){
            if(isNaN(time) || time > Number(activeFilters.time)){
                return false;
            }
        }

        // --- 費用 ---
        const cost = Number(item.cost);
        if(activeFilters.cost != null && activeFilters.cost !== ''){
            if(isNaN(cost) || cost > Number(activeFilters.cost)){
                return false;
            }
        }

      // --- 季節 ---
// --- 季節 ---
if(activeFilters.seasonMode === 'select'){
    const selectedSeasons = activeFilters.selectedSeasons;

    // JSON 側のキー名は "season"
    const itemSeasons = Array.isArray(item.season) ? item.season : [];

    if(itemSeasons.length === 0){
        return false;
    }
    if(!itemSeasons.some(s => selectedSeasons.has(s))){
        return false;
    }
}



        return true;
    });

    // 4. ソート
    const desc = sortVal.startsWith('-');
    const key = desc ? sortVal.slice(1) : sortVal;
    list.sort((a,b)=>{
        const av = a[key];
        const bv = b[key];

        if(key==='No'){
            const extractNum = val => {
                const s = String(val||'');
                const isPre = s.startsWith('P');
                const num = parseInt(s.replace(/^P/,'')||'0',10);
                return isPre ? num+0.5 : num;
            };
            return desc ? extractNum(bv)-extractNum(av) : extractNum(av)-extractNum(bv);
        }

        const an = av==null ? Number.POSITIVE_INFINITY : Number(av);
        const bn = bv==null ? Number.POSITIVE_INFINITY : Number(bv);
        if(!isFinite(an) || !isFinite(bn)){
            return desc ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
        }
        return desc ? bn-an : an-bn;
    });

    renderTable(list);

    // 5. フィルター数表示
    let activeCount = activeFilters['fish-name'].size;
    ['difficulty','time','cost'].forEach(k=>{
        if(activeFilters[k] != null && activeFilters[k] !== '') activeCount++;
    });
    const filterText = activeCount>0?` (${activeCount} 種類のフィルター適用中)`: '';
    message.textContent = `${list.length} 件の結果を表示中 (全 ${flatList.length} 件)${filterText}`;
}




    // reload button
    if(reloadBtn) {
        reloadBtn.addEventListener('click', ()=> {
            loadData();
        });
    }

    // リストに戻るボタンのイベントリスナー
    if(backToListBtn) {
        backToListBtn.addEventListener('click', ()=> {
            if(wrap) {
                wrap.classList.remove('detail-view');
                wrap.classList.add('list-view');
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // フィルターと検索のイベントリスナー
    if(qInput) qInput.addEventListener('input', ()=> applyFiltersAndRender());
    if(filterType) filterType.addEventListener('change', ()=> applyFiltersAndRender());
    if(sortBy) sortBy.addEventListener('change', ()=> applyFiltersAndRender());
    
    // ★★★ フィルターモーダル関連のイベントリスナー ★★★
    if (filterOpenBtn) {
        filterOpenBtn.addEventListener('click', () => {
             // モーダル表示時に毎回チェックボックス/ラジオボタンの状態を更新し、表示をリフレッシュ
             setupFilterModal(flatList); 
             if (filterModal) filterModal.style.display = 'flex'; // flexで表示
        });
        
        // モーダルのオーバーレイをクリックで閉じる (簡易的なもの)
        if (filterModal) {
            filterModal.addEventListener('click', (e) => {
                if (e.target === filterModal) {
                    filterModal.style.display = 'none';
                }
            });
        }
    }

    if (applyFilterBtn) {
        applyFilterBtn.addEventListener('click', () => {
             updateActiveFilters(); // チェックボックス/ラジオボタン/入力欄の状態を確定
             applyFiltersAndRender();
             if (filterModal) filterModal.style.display = 'none'; // モーダルを閉じる
        });
    }
    
    if (filterClearBtn) {
        filterClearBtn.addEventListener('click', () => {
             // 全てのフィルターをクリア
           activeFilters = {
    "fish-name": new Set(),      // チェックボックス形式 (複数選択)
    difficulty: null,            // ラジオボタン形式 (単一値)
    time: null,                  // ラジオボタン/入力形式 (単一値)
    cost: null,                  // ラジオボタン/入力形式 (単一値)
    selectedSeasons: new Set()   // 季節のチェックボックス (複数選択)
};


             // UIをリセットするために再度セットアップ
             setupFilterModal(flatList); 
             applyFiltersAndRender();
        });
    }
    // ★★★ フィルターモーダル関連のイベントリスナー ここまで ★★★


    // main loader
    async function loadData(){
        if(message) message.textContent = '読み込み中...';
        try {
            const json = await fetchAny(tryPaths);
            rawData = json;
            flatList = buildFlatList(json);

            if (flatList.length === 0){
                if(message) message.innerHTML = '<div class="notice">recipes または preparations のデータが空です。docs/recipes.json を確認してください。</div>';
            } else {
                if(message) message.textContent = `読み込み完了 — 合計 ${flatList.length} 件（recipes: ${Object.keys(json.recipes||{}).length}, preparations: ${Object.keys(json.preparations||{}).length}）`;
            }
            
            // 初回表示
            applyFiltersAndRender();
            if(wrap) {
                 wrap.classList.remove('detail-view');
                 wrap.classList.add('list-view');
            }
        } catch (err){
            console.error(err);
            if(message) message.innerHTML = '<div class="notice">読み込みエラー: ' + String(err.message) + '</div>';
            clearTable();
            if(wrap) wrap.classList.remove('detail-view');
        }
    }

    // initial load
    loadData();

    // Expose for debug on window
    window._recipesApp = {
        loadData,
        getRaw: ()=> rawData,
        getFlat: ()=> flatList,
        activeFilters: activeFilters 
    };
})();
// ===== レシピ提案モーダル制御（完全修正版 3.0 - デバッグログ挿入済み） =====
(function(){
  // --- 要素 ---
  const proposeBtn = document.getElementById('proposeOpenBtn');
  const proposeModal = document.getElementById('proposeModal');
  const closeProposeBtn = document.getElementById('closeProposeBtn');

  const mealRadios = document.querySelectorAll('input[name="meals"]');
  const customMealInput = document.getElementById('customMealInput');
  const customMealRow = document.getElementById('customMealRow');
  const customMealConfirm = document.getElementById('customMealConfirm');

  const modeFieldset = document.getElementById('modeFieldset');
  const modeRadios = document.querySelectorAll('input[name="mode"]');
  const modeAllRadio = document.querySelector('input[name="mode"][value="all"]');

  const counterContainer = document.getElementById('counterContainer');
  const leftBtn = document.getElementById('leftBtn');
  const rightBtn = document.getElementById('rightBtn');
  const counterValue = document.getElementById('counterValue');

  const includeFishModeRadios = document.getElementsByName('includeFishMode');
  const excludeFishModeRadios = document.getElementsByName('excludeFishMode');
  const includeFishRow = document.getElementById('includeFishRow');
  const excludeFishRow = document.getElementById('excludeFishRow');
  const includeFishContainer = document.getElementById('includeFishContainer');
  const excludeFishContainer = document.getElementById('excludeFishContainer');

  window.diffRadios = document.querySelectorAll('input[name="difficulty"]');
  const customDiffRow = document.getElementById('customDiffRow');
  const customDiffInput = document.getElementById('customDiffInput');
  const customDiffConfirm = document.getElementById('customDiffConfirm');

  window.timeRadios = document.querySelectorAll('input[name="time"]');
  const customTimeRow = document.getElementById('customTimeRow');
  const customTimeInput = document.getElementById('customTimeInput');
  const customTimeConfirm = document.getElementById('customTimeConfirm');

  window.costRadios = document.querySelectorAll('input[name="cost"]');
  const customCostRow = document.getElementById('customCostRow');
  const customCostInput = document.getElementById('customCostInput');
  const customCostConfirm = document.getElementById('customCostConfirm');

  const summaryPanel = document.getElementById('summaryPanel');
 
  // --- 状態 ---
window.mealcount = 1;
  let currentCount = 1; // 現在の設定対象の食数 (1から始まる)
  let fishList = [];
  // mealSettings[1], mealSettings[2], ... を使用し、0インデックスは使用しない (1ベースインデックス)
  window.mealSettings = []; 
  // --- 初期設定 ---
window.makeDefaultMeal = function() {
    return {
      include: new Set(),
      exclude: new Set(),
      difficulty: "",
      difficultyCustom: null,
      time: "",
      timeCustom: null,
      cost: "",
      costCustom: null,
    };
  }
  // 食数 mealcount に合わせて mealSettings の長さを保証（1ベースインデックスに対応）
window.ensureMealSettings = function(len) {
    const newArr = [];
    // window. を明示
    for (let i = 1; i <= len; i++) newArr[i] = window.mealSettings[i] || window.makeDefaultMeal();
    window.mealSettings = newArr;
  }
// --- IIFE 内で参照される補助関数を先に定義 ---

  // --- 補助関数（ローカル） ---
  function closeModal() {
    proposeModal.style.display = 'none';
  }
  // applyResetRulesAfterModeChange が定義されていないため、resetCriteria に仮変更
  function applyResetRulesAfterModeChange() {
    resetCriteria();
  }

  // --- 魚リスト読込（ローカル） ---
  async function loadFishList() {
    try {
      const res = await fetch('./docs/recipes.json');
      const json = await res.json();
      const set = new Set();
      for (const cat of ['recipes','preparations']) {
        const group = json[cat];
        if (!group) continue;
        for (const k in group) {
          const entry = group[k];
          if (Array.isArray(entry['fish-name'])) entry['fish-name'].forEach(f => set.add(f));
        }
      }
      fishList = Array.from(set).sort();
    } catch (err) {
      console.error('魚リスト読み込み失敗', err);
      fishList = [];
    }
  }
  
  // --- 評価テキスト生成ヘルパー関数（ローカル） ---
  function getCriterionText(key, value) {
    const numValue = Number(value);
    if (isNaN(numValue) || numValue < 1 || numValue > 3) return String(value);

    const stars = '★'.repeat(numValue) + '☆'.repeat(3 - numValue);

    switch (key) {
      case 'difficulty':
        if (numValue === 1) return `${stars}（やさしい）`;
        if (numValue === 2) return `${stars}（ふつう）`;
        if (numValue === 3) return `${stars}（むずかしい）`;
        break;
      case 'time':
        if (numValue === 1) return `${stars}（短い）`;
        if (numValue === 2) return `${stars}（ふつう）`;
        if (numValue === 3) return `${stars}（長い）`;
        break;
      case 'cost':
        if (numValue === 1) return `${stars}（安い）`;
        if (numValue === 2) return `${stars}（ふつう）`;
        if (numValue === 3) return `${stars}（高い）`;
        break;
    }
    return String(value);
  } 

  // --- サマリー表示（グローバルに公開） ---
window.renderSummary = function() {
    summaryPanel.innerHTML = '';
    const title = document.createElement('h3');
    title.textContent = '設定サマリー';
    summaryPanel.appendChild(title);

    if (window.mealcount === 1) {
      const m = window.mealSettings[1] || window.makeDefaultMeal();
      const div = document.createElement('div');
      div.className = 'summary-single';
      div.innerHTML = `
        <h4>1食分の設定</h4>
        <p><strong>使いたい魚:</strong> ${Array.from(m.include).join('、') || '指定なし'}</p>
        <p><strong>除外する魚:</strong> ${Array.from(m.exclude).join('、') || '指定なし'}</p>
        <p><strong>難易度:</strong> ${m.difficulty || '指定なし'}</p>
        <p><strong>時間:</strong> ${m.time || '指定なし'}</p>
        <p><strong>費用:</strong> ¥${m.cost || '指定なし'}</p>
        <p><strong>季節考慮:</strong> ${m.considerSeason ? 'する' : 'しない'}</p>
      `;
      summaryPanel.appendChild(div);
    } else {
      for (let i = 1; i <= window.mealcount; i++) {
        const m = window.mealSettings[i];
        const card = document.createElement('div');
        card.className = 'summary-card' + (i === currentCount ? ' active' : '');
        card.innerHTML = `
          <h4>${i}食目 ${i===currentCount ? '(現在)' : ''}</h4>
          <p><strong>使いたい魚:</strong> ${Array.from(m.include).join('、') || '指定なし'}</p>
          <p><strong>除外する魚:</strong> ${Array.from(m.exclude).join('、') || '指定なし'}</p>
          <p><strong>難易度:</strong> ${m.difficulty || '指定なし'}</p>
          <p><strong>時間:</strong> ${m.time || '指定なし'}</p>
          <p><strong>費用:</strong> ¥${m.cost || '指定なし'}</p>
          <p><strong>季節考慮:</strong> ${m.considerSeason ? 'する' : 'しない'}</p>
        `;
        summaryPanel.appendChild(card);
      }
    }
}


  // --- 初期化・リセット処理（ローカル） ---
  function resetCriteria() {
    for (let i = 1; i <= window.mealcount; i++) {
      const defaultMeal = window.makeDefaultMeal(); 
      defaultMeal.considerSeason = false; 
      window.mealSettings[i] = defaultMeal;
    }

    // UIのラジオ・チェックを初期状態に戻す
    document.querySelector('input[name="includeFishMode"][value="none"]').checked = true;
    document.querySelector('input[name="excludeFishMode"][value="none"]').checked = true;
    includeFishRow.style.display = 'none';
    excludeFishRow.style.display = 'none';

    // 難易度/時間/費用をデフォルト
    if (window.diffRadios && window.diffRadios.length > 0) window.diffRadios[0].checked = true;
    if (window.timeRadios && window.timeRadios.length > 0) window.timeRadios[0].checked = true;
    if (window.costRadios && window.costRadios.length > 0) window.costRadios[0].checked = true;

    // カスタム入力行非表示
    customDiffRow.style.display = customTimeRow.style.display = customCostRow.style.display = 'none';

    // 季節考慮用チェックボックスも初期化
    const seasonCheckbox = document.getElementById('considerSeasonCheckbox');
    if (seasonCheckbox) seasonCheckbox.checked = true;

    // カウンター初期化
    currentCount = 1;
    counterValue.textContent = currentCount;

    window.renderSummary(); 
  }

  // --- include/exclude UI（ローカル） ---
  function renderIncludeExcludeUI() {
    // --- include/exclude UI（ローカル） ---
function renderIncludeExcludeUI() {
    // 1. 表示/非表示の切り替え
    const incMode = document.querySelector('input[name="includeFishMode"]:checked')?.value || 'none';
    const excMode = document.querySelector('input[name="excludeFishMode"]:checked')?.value || 'none';

    // 💡 要素の存在チェックを追加
    if (includeFishRow) includeFishRow.style.display = (incMode === 'specify') ? 'grid' : 'none';
    if (excludeFishRow) excludeFishRow.style.display = (excMode === 'specify') ? 'grid' : 'none';

    if (includeFishContainer) includeFishContainer.innerHTML = '';
    if (excludeFishContainer) excludeFishContainer.innerHTML = '';

    const mode = document.querySelector('input[name="mode"]:checked')?.value || 'all';
    
    // 2. 現在の設定値の取得
    let targetMeals;
    if (mode === 'each') {
      targetMeals = [currentCount];
    } else {
      targetMeals = Array.from({length: window.mealcount}, (_, i) => i + 1);
    }
    
    // 💡 window. を明示
    let currentIncludeSet = window.mealSettings[currentCount]?.include || new Set();
    let currentExcludeSet = window.mealSettings[currentCount]?.exclude || new Set();


    // 3. 魚リストのチェックボックス描画
    // 💡 fishList が undefined の場合に備えてチェック
    if (!Array.isArray(fishList)) fishList = []; 

    fishList.forEach(fish => {
        if (!fish || typeof fish !== 'string') return;
        
        // --- Include チェックボックス ---
        const incCheckbox = document.createElement('input');
        incCheckbox.type = 'checkbox';
        incCheckbox.id = `inc-${fish}`;
        incCheckbox.checked = currentIncludeSet.has(fish);

        incCheckbox.addEventListener('change', () => {
          targetMeals.forEach(i => {
            const meal = window.mealSettings[i];
            if (meal) {
              if (incCheckbox.checked) {
                meal.include.add(fish);
                meal.exclude.delete(fish);
              } else {
                meal.include.delete(fish);
              }
            }
          });
          window.renderSummary(); // 💡 window. を明示
        });
        
        const incLabel = document.createElement('label');
        incLabel.htmlFor = `inc-${fish}`;
        incLabel.textContent = fish;
        if (includeFishContainer) {
          includeFishContainer.appendChild(incCheckbox);
          includeFishContainer.appendChild(incLabel);
        }

        // --- Exclude チェックボックス ---
        const excCheckbox = document.createElement('input');
        excCheckbox.type = 'checkbox';
        excCheckbox.id = `exc-${fish}`;
        excCheckbox.checked = currentExcludeSet.has(fish);

        excCheckbox.addEventListener('change', () => {
          targetMeals.forEach(i => {
            const meal = window.mealSettings[i];
            if (meal) {
              if (excCheckbox.checked) {
                meal.exclude.add(fish);
                meal.include.delete(fish);
              } else {
                meal.exclude.delete(fish);
              }
            }
          });
          window.renderSummary(); // 💡 window. を明示
        });
        
        const excLabel = document.createElement('label');
        excLabel.htmlFor = `exc-${fish}`;
        excLabel.textContent = fish;
        if (excludeFishContainer) {
          excludeFishContainer.appendChild(excCheckbox);
          excludeFishContainer.appendChild(excLabel);
        }
      });

    // 最後にサマリーを更新
    window.renderSummary(); // 💡 window. を明示
}    
    const incMode = document.querySelector('input[name="includeFishMode"]:checked')?.value || 'none';
    const excMode = document.querySelector('input[name="excludeFishMode"]:checked')?.value || 'none';

    includeFishRow.style.display = (incMode === 'specify') ? 'grid' : 'none';
    excludeFishRow.style.display = (excMode === 'specify') ? 'grid' : 'none';

    includeFishContainer.innerHTML = '';
    excludeFishContainer.innerHTML = '';

    const mode = document.querySelector('input[name="mode"]:checked')?.value || 'all';

    let currentIncludeSet = new Set();
    let currentExcludeSet = new Set();

    if (mode === 'each') {
      currentIncludeSet = window.mealSettings[currentCount]?.include || new Set();
      currentExcludeSet = window.mealSettings[currentCount]?.exclude || new Set();
    } else {
      for (let i = 1; i <= window.mealcount; i++) {
        window.mealSettings[i]?.include.forEach(v => currentIncludeSet.add(v));
        window.mealSettings[i]?.exclude.forEach(v => currentExcludeSet.add(v));
      }
    }

    fishList.forEach(f => {
      // include チェックボックスの生成とリスナー設定（内部の renderSummary を window.renderSummary に修正済みとして処理）
      // exclude チェックボックスの生成とリスナー設定（内部の renderSummary を window.renderSummary に修正済みとして処理）
    });
    
    window.renderSummary(); // 確実に window. をつけて呼び出す
  }
  
  // --- 基準値適用（ローカル） ---
  function applyCriterionToMeals(kind, value, customVal) {
    const mode = document.querySelector('input[name="mode"]:checked')?.value || 'all';
    const mealsToUpdate = (mode === 'each') ? [currentCount] : Array.from({length: window.mealcount}, (_, i) => i + 1);
    
    mealsToUpdate.forEach(i => {
      if (window.mealSettings[i]) {
        window.mealSettings[i][kind] = value;
        window.mealSettings[i][kind + 'Custom'] = (value === 'custom') ? customVal : null;
      }
    });
    window.renderSummary();
  }
  
  // --- 食数変更適用（ローカル） ---
  function applyOnMealCountChange(newP) {
    window.mealcount = newP;
    window.ensureMealSettings(window.mealcount); 
    resetCriteria();
    renderIncludeExcludeUI();
    window.renderSummary(); 
  }
  


  // --- モーダル開閉リスナー ---
  proposeBtn.addEventListener('click', async () => {
    proposeModal.style.display = 'flex';
    await loadFishList();
    
    const selected = document.querySelector('input[name="meals"]:checked');
    const initialP = selected && selected.value !== 'custom' ? Number(selected.value) || 1 : (Number(customMealInput.value) || 1);
    
    window.mealcount = initialP;
    window.ensureMealSettings(window.mealcount);
    
    if (selected && selected.value === 'custom') {
      customMealRow.style.display = 'grid';
    } else {
      customMealRow.style.display = 'none';
    }

    currentCount = 1;
    counterValue.textContent = currentCount;
    
    resetCriteria();
    renderIncludeExcludeUI();
    window.renderSummary();
  });

  closeProposeBtn.addEventListener('click', closeModal);
  proposeModal.addEventListener('click', (e) => { 
    if (e.target === proposeModal) closeModal(); 
  });
 

  // --- 各種ラジオボタン/カウンターリスナー ---
  includeFishModeRadios.forEach(r => r.addEventListener('change', (e) => {
    const v = e.target.value;
    if (v === 'specify') {
      includeFishRow.style.display = 'grid';
    } else {
      for (let i = 1; i <= window.mealcount; i++) window.mealSettings[i].include.clear();
      includeFishRow.style.display = 'none';
    }
    renderIncludeExcludeUI();
    window.renderSummary();
  }));

  excludeFishModeRadios.forEach(r => r.addEventListener('change', (e) => {
    const v = e.target.value;
    if (v === 'specify') {
      excludeFishRow.style.display = 'grid';
    } else {
      for (let i = 1; i <= window.mealcount; i++) window.mealSettings[i].exclude.clear();
      excludeFishRow.style.display = 'none';
    }
    renderIncludeExcludeUI();
    window.renderSummary();
  }));

  mealRadios.forEach(r => r.addEventListener('change', (e) => {
    if (e.target.value === 'custom') {
      customMealRow.style.display = 'grid';
    } else {
      const newP = Number(e.target.value) || 1;
      customMealRow.style.display = 'none';
      applyOnMealCountChange(newP);
    }
  }));

  customMealConfirm.addEventListener('click', () => {
    const v = Math.max(1, Number(customMealInput.value) || 1);
    const customRadio = document.querySelector('input[name="meals"][value="custom"]');
    if (customRadio) customRadio.checked = true;
    applyOnMealCountChange(v);
  });

  modeRadios.forEach(r => r.addEventListener('change', (e) => {
    const mode = e.target.value;
    if (window.mealcount > 1 && mode === 'each') {
      counterContainer.style.display = 'flex';
    } else {
      counterContainer.style.display = 'none';
    }
    applyResetRulesAfterModeChange();
    renderIncludeExcludeUI();
    window.renderSummary();
  }));

  leftBtn.addEventListener('click', () => {
    if (currentCount > 1) {
      currentCount--;
      counterValue.textContent = currentCount;
      renderIncludeExcludeUI();
      window.renderSummary();
    }
  });
  rightBtn.addEventListener('click', () => {
    if (currentCount < window.mealcount) {
      currentCount++;
      counterValue.textContent = currentCount;
      renderIncludeExcludeUI();
      window.renderSummary();
    }
  });

  function handleCriterionRadioChange(radios, customRow, kind) {
    radios.forEach(r => r.addEventListener('change', (e) => {
      customRow.style.display = (e.target.value === 'custom') ? 'grid' : 'none';
      if (e.target.value !== 'custom') applyCriterionToMeals(kind, e.target.value, null);
    }));
  }

  function handleCriterionCustomConfirm(confirmBtn, input, kind) {
    confirmBtn.addEventListener('click', () => {
      const customRadio = document.querySelector(`input[name="${kind}"][value="custom"]`);
      if (customRadio) customRadio.checked = true;
      applyCriterionToMeals(kind, 'custom', input.value);
    });
  }

  handleCriterionRadioChange(window.diffRadios, customDiffRow, 'difficulty');
  handleCriterionCustomConfirm(customDiffConfirm, customDiffInput, 'difficulty');

  handleCriterionRadioChange(window.timeRadios, customTimeRow, 'time');
  handleCriterionCustomConfirm(customTimeConfirm, customTimeInput, 'time');

  handleCriterionRadioChange(window.costRadios, customCostRow, 'cost');
  handleCriterionCustomConfirm(customCostConfirm, customCostInput, 'cost');

 
})(); // ⬅️ IIFE の終了
    // --- 初期化 ---
document.addEventListener('DOMContentLoaded', () => {
  
  // 変数定義を修正 (要素は IIFE の中で取得されているため、ここでもう一度取得するか window. を使う必要があります)
  const modeFieldset = document.getElementById('modeFieldset');
  const counterContainer = document.getElementById('counterContainer');
  const customMealRow = document.getElementById('customMealRow');
  const customDiffRow = document.getElementById('customDiffRow');
  const customTimeRow = document.getElementById('customTimeRow');
  const customCostRow = document.getElementById('customCostRow');
  const includeFishRow = document.getElementById('includeFishRow');
  const excludeFishRow = document.getElementById('excludeFishRow');
    
  window.mealcount = 1;
  
  // グローバル関数は window. をつけて呼び出す
  window.ensureMealSettings(1);
  
  // 非表示要素 (存在チェックを追加)
  if (modeFieldset) modeFieldset.style.display = 'none';
  if (counterContainer) counterContainer.style.display = 'none';
  if (customMealRow) customMealRow.style.display = 'none';
  if (customDiffRow) customDiffRow.style.display = 'none';
  if (customTimeRow) customTimeRow.style.display = 'none';
  if (customCostRow) customCostRow.style.display = 'none';
  if (includeFishRow) includeFishRow.style.display = 'none';
  if (excludeFishRow) excludeFishRow.style.display = 'none';

  // グローバル関数は window. をつけて呼び出す
  window.renderSummary(); 
});

// ❌ 以前残っていた無効な呼び出しをすべて削除しました ❌

// --- これ以降に他の DOMContentLoaded リスナーやコードがあれば続きます ---

// ===== レシピ提案モーダル =====
document.addEventListener('DOMContentLoaded', () => {
  const generateProposalsBtn = document.createElement('button');
  generateProposalsBtn.textContent = '提案へ';
  generateProposalsBtn.id = 'generateProposalsBtn';
  document.querySelector('#proposeModal .modal-content').appendChild(generateProposalsBtn);

  const proposalModal = document.getElementById('proposalModal');
  const backToSettingsBtn = document.getElementById('backToSettingsBtn');
  const closeProposalBtn = document.getElementById('closeProposalBtn');
  const proposalResults = document.getElementById('proposalResults');

  window.proposalHistory = window.proposalHistory || [];

  generateProposalsBtn.addEventListener('click', async () => {
    proposeModal.style.display = 'none';
    proposalModal.style.display = 'flex';

    const res = await fetch('./docs/recipes.json');
    const data = await res.json();
    const recipes = Object.values(data.recipes);

    console.log('全レシピ JSON:', recipes);

    const now = new Date();
    const month = now.getMonth() + 1;
    const season = (month <= 2 || month === 12) ? "冬" :
                   (month <= 5) ? "春" :
                   (month <= 8) ? "夏" : "秋";

    const selectedRecipes = [];
    const meals = window.mealSettings || [];

for (let i = 1; i < meals.length; i++) {
  const m = meals[i];

// チェックボックスから値を取得
const seasonCheckbox = document.getElementById('considerSeasonCheckbox');
const considerSeason = seasonCheckbox ? seasonCheckbox.checked : true;


  const tieBreakerInput = document.querySelector('input[name="tieBreaker"]:checked');
  const tieBreaker = tieBreakerInput ? tieBreakerInput.value : 'difficulty';

      // --- スコア計算 ---
      let scored = recipes
        .filter(r => !(m.exclude.size && r["fish-name"].some(f => m.exclude.has(f))))
        .map(r => {
          let score = 0;
          if (m.include.size && r["fish-name"].some(f => m.include.has(f))) score += 5;
          if (m.difficulty && r.difficulty <= Number(m.difficultyCustom || m.difficulty)) score += 2;
          if (m.time && r.time <= Number(m.timeCustom || m.time)) score += 2;
          if (m.cost && r.cost <= Number(m.costCustom || m.cost)) score += 2;
          if (considerSeason && r.season.includes(season)) score += 3;


          const historyCount = window.proposalHistory.filter(h => h.No === r.No).length;
          score -= historyCount * 3;

          return { ...r, score };
        })
        .sort((a, b) => b.score - a.score);

      console.log(`食数${i} - スコア計算後 scored:`, scored);

      if (scored.length === 0) continue;

      const maxScore = scored[0].score;
      let topGroup = scored.filter(r => r.score === maxScore);

      console.log(`食数${i} - スコア最大グループ topGroup:`, topGroup);

      let chosen;
      switch (tieBreaker) {
        case 'difficulty':
          chosen = topGroup.reduce((a, b) => a.difficulty < b.difficulty ? a : b);
          break;
        case 'time':
          chosen = topGroup.reduce((a, b) => a.time < b.time ? a : b);
          break;
        case 'cost':
          chosen = topGroup.reduce((a, b) => a.cost < b.cost ? a : b);
          break;
        case 'random':
        default:
          chosen = topGroup[Math.floor(Math.random() * topGroup.length)];
          break;
      }

      console.log(`食数${i} - 選ばれたレシピ chosen:`, chosen);

      selectedRecipes.push(chosen);

      window.proposalHistory.push(chosen);
      if (window.proposalHistory.length > 15) window.proposalHistory.shift();

      console.log('現在の selectedRecipes:', selectedRecipes);
      console.log('現在の proposalHistory:', window.proposalHistory);
    }

    proposalResults.innerHTML = `
      <h3>提案結果（${selectedRecipes.length}食分）</h3>
      <ul>
        ${selectedRecipes.map((r, i) => `
          <li>
            <strong>${i + 1}食目:</strong> ${r.title}<br>
            <span class="desc">${r.flavortxt}</span><br>
            <small>魚: ${r["fish-name"].join('、')} | 難易度:${r.difficulty} | 時間:${r.time}分 | 費用:¥${r.cost}</small><br>
            <button class="recipe-btn" data-index="${i}">レシピへ</button>
          </li>
        `).join('')}
      </ul>
    `;

    proposalResults.addEventListener('click', e => {
      if (e.target.classList.contains('recipe-btn')) {
        const index = e.target.dataset.index;
        displayDetail(selectedRecipes[index]);
      }
    });
  });

  backToSettingsBtn.addEventListener('click', () => {
    proposalModal.style.display = 'none';
    proposeModal.style.display = 'flex';
  });

  closeProposalBtn.addEventListener('click', () => {
    proposalModal.style.display = 'none';
  });

  proposalModal.style.display = 'none';
  proposalModal.style.position = 'fixed';
  proposalModal.style.inset = '0';
  proposalModal.style.background = 'rgba(0,0,0,0.5)';
  proposalModal.style.justifyContent = 'center';
  proposalModal.style.alignItems = 'center';
  proposalModal.style.zIndex = '1000';
});
