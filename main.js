data_who = ["ロリ", "シマナガ", "ペンギン", "ウミウシ", "どーなっつ",
"猫", "犬", "蝶", "妖精", "そらちゃん",
"宝石", "メスロボット", "宝正マリン", "azuki", "ガウルグラ",
"メンヘラ天使", "陰気魔女", "神聖存在アイドル", "明るい霊的存在", "ばばあ",
"憎めないカス", "メス魔物", "ロり神", "ガチカス", "天才ロリ",
"巨乳妹", "清楚ビッチ", "ギャル純情", "汚いおじさん", "じじい",
"真白ちゃん", "ロリビッチ", "悪役令嬢", "お嬢様キャラ", "リコちゃん",
"メスアンドロイド", "人格をもつ無機物", "殺し屋", "ガチムチ", "イケメン",
"スバル", "こより", "石神", "かなぴん", "ぷるもち"];

data_state = ["テレ顔", "逆の属性", "軽い虐待", "水着", "デカパーカー",
"絶望顔", "気持ちよくなってる顔", "恥ずかしい格好", "笑顔", "なついてる",
"男である", "女である", "性別なし", "両性", "特殊TS",
"卵を産み付けられる", "元気な娘をいじめる", "ロリの脳破壊", "拷問",
"なめる", "セックス", "一緒に寝る", "アンニュイ", "私でしこっていいよ",
"いやじゃ…", "バニー", "浴衣", "チャイナドレス", "パンツ",
"真剣な表情をしている。","なめられる",
"楽しそうに笑っている。",
"雨に降られてぬれてしまった。",
"食事を楽しんでいる。",
"本を読んでいる。",
"感動している。",
"地図を見ながら道に迷っている。",
"汗をかきながらトレーニングしている。",
"吹き消している。",
"観光名所を楽しんでいる。",
"治療方法を決めている。",
"本を読んでいる。",
"ルールに従っている。",
"自宅で料理を作っている最中。",
"映画を楽しんでいる。",
"仕事をしている。",
"ハイキングをしている。",
"友人とおしゃべりしている。",
"きらびやかな花火を見上げている"];

data_where = ["時間", "風呂", "道端", "教室", "ベッド",
"宇宙", "観察室", "拘束部屋", "丘の上", "海",
"砂浜", "不思議空間", "@@しないと出られない部屋", "川", "森","花火大会","カフェ","山の中",
"映画館","車の運転中","電車の中","病院","旅行中","誕生日パーティー","スポーツジム",
"コンサート会場","レストラン","公園","会議中"];


data_howDo = ["大人の恋愛", "卵を産み付けられる", "精神を虐待", "ロリの脳破壊", "拷問",
"無垢ハーレム", "なろう展開", "なめる", "セックス", "一緒に寝る",
"純愛", "未来で会える", "友になる", "エモい", "復讐する",
"タイムリープ", "私でしこっていいよ"];
//状態は任意の数出力してほしい
// whoと状態にワードを追加したい

function viewResult(target_id){
    var target = document.getElementById(target_id);
    target.innerHTML = rlt;
}

rlt = ""
rlt_who = "";
rlt_state = [];

times_state = 2;

function generate1(){
rlt = "";

id_who = Math.floor(Math.random()*data_who.length);
rlt += data_who[id_who];
rlt += "が、"

ids_st = [];
for(let i =0; i<times_state; i++){
    id_st = Math.floor(Math.random()*data_state.length);
    // rlt_state.push(data_state[id_st]);
    if(ids_st.includes(id_st)){

    }else{
        rlt += data_state[id_st] + "、"
        ids_st.push(id_st);
    }
    
}
rlt += " in "
id_where = Math.floor(Math.random()*data_where.length);
    rlt += data_where[id_where];

viewResult("result1");
}

function generate2(){
    rlt = "";
    
    id_who = Math.floor(Math.random()*data_who.length);
    rlt += data_who[id_who];
    rlt += "が、"

    id_where = Math.floor(Math.random()*data_where.length);
    rlt += data_where[id_where];
    rlt += "で、"

    

    id_how = Math.floor(Math.random()*data_howDo.length);
    rlt += data_howDo[id_how];

    rlt += " with ";
    id_who = Math.floor(Math.random()*data_who.length);
    rlt += data_who[id_who];
    
    
    viewResult("result2");
    }