/**
 * UI language.
 *
 * Scope is deliberate: this translates the SITE'S OWN words — navigation,
 * column headers, the honesty disclaimers — and never the data. Card, set and
 * product names stay exactly as their source prints them, because a Pokémon's
 * name is not a string to be machine-translated: リーフィアex and Leafeon ex are
 * the same card, and a reader searching either one needs to find it. Japanese
 * sets already carry Japanese names from Scrydex; English sets stay English in
 * every UI language.
 *
 * Missing keys fall back to English rather than rendering a key, so a partial
 * translation degrades into a mixed-language page instead of a broken one.
 */

export const LOCALES = {
  en: { label: "English", native: "English" },
  ja: { label: "Japanese", native: "日本語" },
  zh: { label: "Chinese", native: "中文" },
  es: { label: "Spanish", native: "Español" },
  fr: { label: "French", native: "Français" },
  de: { label: "German", native: "Deutsch" },
} as const;

export type Locale = keyof typeof LOCALES;
export const LOCALE_CODES = Object.keys(LOCALES) as Locale[];

export function isLocale(v: string | null | undefined): v is Locale {
  return v !== null && v !== undefined && v in LOCALES;
}

/** Every translatable string, keyed by a stable English-ish identifier. */
export const STRINGS = {
  en: {
    "filter.cardLanguage": "Card language",
    "jp.about.title": "About Japanese sets.",
    "jp.about.body":
      "Cards, rarities and prices come from Scrydex — real Japanese tiers, not a translation of the English ones — and prices are converted from the USD figures Scrydex quotes. Card and set names stay in Japanese; they are never machine translated. Only a few Japanese sets are ranked so far, because ranking one needs a pull-rate study for that set, and Japanese odds are far less documented than English ones. Japanese boxes also often carry published per-box guarantees (Terastal Festival ex guarantees one SAR per box), which are modelled per set rather than assumed era-wide. Sets without that research stay unranked instead of being given invented odds.",
    "nav.rankings": "Rankings",
    "nav.collection": "Collection",
    "nav.methodology": "Methodology",
    "disclaimer.banner":
      "Pull rates are community estimates, not official odds — every EV here is a projection, not a promise.",
    "rankings.title": "Sealed product rankings",
    "rankings.subtitle":
      "What a sealed product is worth to open, from pull rates × live card prices. Each set carries a badge showing how well-evidenced its odds are.",
    "filter.sources": "Sources",
    "filter.blend": "blend",
    "filter.show": "Show",
    "filter.graded": "Graded (PSA)",
    "filter.retail": "Retail (MSRP)",
    "filter.market": "Market",
    "filter.sort": "Sort",
    "filter.search": "Search set or product…",
    "filter.allTypes": "All product types",
    "filter.allGenerations": "All generations",
    "filter.anyConfidence": "Any confidence",
    "filter.worthOpening": "Worth opening (+ROI)",
    "filter.shown": "shown",
    "col.retail": "Retail",
    "col.market": "Market",
    "col.avgUnbox": "Avg. unbox",
    "col.roi": "ROI",
    "col.language": "Site language",
    "col.currency": "Currency",
    "product.expectedValue": "Expected value",
    "product.retailMsrp": "Retail (MSRP)",
    "product.currentMarket": "Current market",
    "product.ifRetail": "if you can find it at retail price",
    "product.livePrice": "live market price",
    "product.valueFrom": "Where the value comes from",
    "grading.title": "Is it worth grading?",
    "footer.notAdvice": "Not financial or gambling advice. Estimates carry real error — see",
    "footer.methodology": "methodology",
    "note.pricesUsd": "Prices shown in US dollars — live conversion is unavailable right now.",
    "note.cardNames":
      "Card and set names always appear in their own language, never machine-translated.",
  },

  ja: {
    "filter.cardLanguage": "カードの言語",
    "jp.about.title": "日本語セットについて",
    "jp.about.body":
      "カード・レアリティ・価格は Scrydex から取得しています。英語版レアリティの翻訳ではなく、実際の日本語レアリティ（ダブルレア／アートレア／スーパーレア／スペシャルアートレア）です。価格は Scrydex が提示する米ドル建ての数値を換算したものです。カード名・セット名は機械翻訳せず日本語のまま表示します。現時点でランキング対象の日本語セットが少ないのは、ランキングに載せるにはそのセット固有の封入率データが必要で、日本語版の確率は英語版ほど公開されていないためです。また日本語のボックスには公表された「1BOXにSAR1枚」といった保証（テラスタルフェスex など）があることが多く、これは時代ごとの一律推定ではなくセット単位でモデル化しています。根拠のないセットには推測値を与えず、未ランキングのままにしています。",
    "nav.rankings": "ランキング",
    "nav.collection": "コレクション",
    "nav.methodology": "算出方法",
    "disclaimer.banner":
      "封入率は公式の確率ではなくコミュニティの推定値です。期待値はあくまで予測であり、保証ではありません。",
    "rankings.title": "未開封商品ランキング",
    "rankings.subtitle":
      "封入率 × 最新カード価格から算出した開封時の期待値。各セットのバッジが根拠の強さを示します。",
    "filter.sources": "価格ソース",
    "filter.blend": "統合方法",
    "filter.show": "表示",
    "filter.graded": "鑑定品 (PSA)",
    "filter.retail": "定価 (MSRP)",
    "filter.market": "市場価格",
    "filter.sort": "並び替え",
    "filter.search": "セット・商品を検索…",
    "filter.allTypes": "すべての商品タイプ",
    "filter.allGenerations": "すべての世代",
    "filter.anyConfidence": "信頼度を問わない",
    "filter.worthOpening": "開封する価値あり (+ROI)",
    "filter.shown": "件",
    "col.retail": "定価",
    "col.market": "市場",
    "col.avgUnbox": "平均開封額",
    "col.roi": "ROI",
    "col.language": "サイトの言語",
    "col.currency": "通貨",
    "product.expectedValue": "期待値",
    "product.retailMsrp": "定価 (MSRP)",
    "product.currentMarket": "現在の市場価格",
    "product.ifRetail": "定価で購入できた場合",
    "product.livePrice": "最新の市場価格",
    "product.valueFrom": "価値の内訳",
    "grading.title": "鑑定に出す価値はある？",
    "footer.notAdvice": "投資・ギャンブルの助言ではありません。推定値には誤差があります —",
    "footer.methodology": "算出方法",
    "note.pricesUsd": "現在は為替レートを取得できないため、米ドルで表示しています。",
    "note.cardNames": "カード名・セット名は機械翻訳せず、常に原語で表示します。",
  },

  zh: {
    "filter.cardLanguage": "卡牌语言",
    "jp.about.title": "关于日文系列",
    "jp.about.body":
      "卡牌、稀有度与价格均来自 Scrydex——采用真实的日文稀有度分级，而非英文分级的翻译；价格由 Scrydex 提供的美元数值换算而来。卡牌与系列名称保留日文原文，不做机器翻译。目前仅有少数日文系列进入排行榜，因为排名需要该系列自身的抽卡率研究，而日文版的概率公开程度远不如英文版。日文原盒通常还带有官方公布的每盒保底（例如「太晶祭 ex」保证每盒 1 张 SAR），我们按系列单独建模，而不套用整个世代的估算。缺乏研究依据的系列宁可不排名，也不会使用凭空推测的概率。",
    "nav.rankings": "排行榜",
    "nav.collection": "收藏",
    "nav.methodology": "计算方法",
    "disclaimer.banner":
      "抽卡率为社群估算值，并非官方公布的概率——所有期望值均为推算，不构成保证。",
    "rankings.title": "未拆封商品排行榜",
    "rankings.subtitle":
      "以抽卡率 × 实时卡价计算的开封期望值。每个系列的标签显示其概率依据的可靠程度。",
    "filter.sources": "价格来源",
    "filter.blend": "汇总方式",
    "filter.show": "显示",
    "filter.graded": "评级卡 (PSA)",
    "filter.retail": "官方定价 (MSRP)",
    "filter.market": "市场价",
    "filter.sort": "排序",
    "filter.search": "搜索系列或商品…",
    "filter.allTypes": "所有商品类型",
    "filter.allGenerations": "所有世代",
    "filter.anyConfidence": "任意可信度",
    "filter.worthOpening": "值得开封 (+ROI)",
    "filter.shown": "个",
    "col.retail": "定价",
    "col.market": "市场",
    "col.avgUnbox": "平均开封值",
    "col.roi": "回报率",
    "col.language": "网站语言",
    "col.currency": "货币",
    "product.expectedValue": "期望值",
    "product.retailMsrp": "官方定价 (MSRP)",
    "product.currentMarket": "当前市场价",
    "product.ifRetail": "若能以定价买到",
    "product.livePrice": "实时市场价",
    "product.valueFrom": "价值构成",
    "grading.title": "值得送评吗？",
    "footer.notAdvice": "非投资或博彩建议。估算存在实际误差 —— 参见",
    "footer.methodology": "计算方法",
    "note.pricesUsd": "目前无法获取汇率，价格以美元显示。",
    "note.cardNames": "卡牌与系列名称始终保留原文，不做机器翻译。",
  },

  es: {
    "filter.cardLanguage": "Idioma de las cartas",
    "nav.rankings": "Clasificación",
    "nav.collection": "Colección",
    "nav.methodology": "Metodología",
    "disclaimer.banner":
      "Las probabilidades son estimaciones de la comunidad, no cifras oficiales: cada valor esperado es una proyección, no una promesa.",
    "rankings.title": "Clasificación de producto sellado",
    "rankings.subtitle":
      "Valor esperado de abrir, según probabilidades de la comunidad × precios actuales. Los sets sin datos reales quedan ocultos.",
    "filter.sources": "Fuentes",
    "filter.blend": "combinación",
    "filter.show": "Mostrar",
    "filter.graded": "Graduadas (PSA)",
    "filter.retail": "Precio de tienda (MSRP)",
    "filter.market": "Mercado",
    "filter.sort": "Ordenar",
    "filter.search": "Buscar set o producto…",
    "filter.allTypes": "Todos los productos",
    "filter.allGenerations": "Todas las generaciones",
    "filter.anyConfidence": "Cualquier confianza",
    "filter.worthOpening": "Vale la pena abrir (+ROI)",
    "filter.shown": "mostrados",
    "col.retail": "Tienda",
    "col.market": "Mercado",
    "col.avgUnbox": "Valor medio",
    "col.roi": "ROI",
    "col.language": "Idioma del sitio",
    "col.currency": "Moneda",
    "product.expectedValue": "Valor esperado",
    "product.retailMsrp": "Precio de tienda (MSRP)",
    "product.currentMarket": "Mercado actual",
    "product.ifRetail": "si lo encuentras a precio de tienda",
    "product.livePrice": "precio de mercado en vivo",
    "product.valueFrom": "De dónde viene el valor",
    "grading.title": "¿Vale la pena graduarla?",
    "footer.notAdvice":
      "No es asesoramiento financiero ni sobre apuestas. Las estimaciones tienen error real — consulta la",
    "footer.methodology": "metodología",
    "note.pricesUsd": "Precios en dólares: la conversión en vivo no está disponible ahora.",
    "note.cardNames":
      "Los nombres de cartas y sets aparecen siempre en su idioma original, sin traducción automática.",
  },

  fr: {
    "filter.cardLanguage": "Langue des cartes",
    "nav.rankings": "Classement",
    "nav.collection": "Collection",
    "nav.methodology": "Méthodologie",
    "disclaimer.banner":
      "Les taux de tirage sont des estimations de la communauté, pas des chiffres officiels — chaque valeur attendue est une projection, pas une promesse.",
    "rankings.title": "Classement des produits scellés",
    "rankings.subtitle":
      "Valeur attendue à l'ouverture, d'après les taux communautaires × les prix actuels. Les sets sans données réelles restent masqués.",
    "filter.sources": "Sources",
    "filter.blend": "combinaison",
    "filter.show": "Afficher",
    "filter.graded": "Gradées (PSA)",
    "filter.retail": "Prix conseillé (MSRP)",
    "filter.market": "Marché",
    "filter.sort": "Trier",
    "filter.search": "Rechercher un set ou produit…",
    "filter.allTypes": "Tous les produits",
    "filter.allGenerations": "Toutes les générations",
    "filter.anyConfidence": "Toute confiance",
    "filter.worthOpening": "Vaut la peine d'ouvrir (+ROI)",
    "filter.shown": "affichés",
    "col.retail": "Boutique",
    "col.market": "Marché",
    "col.avgUnbox": "Valeur moyenne",
    "col.roi": "ROI",
    "col.language": "Langue du site",
    "col.currency": "Devise",
    "product.expectedValue": "Valeur attendue",
    "product.retailMsrp": "Prix conseillé (MSRP)",
    "product.currentMarket": "Marché actuel",
    "product.ifRetail": "si vous le trouvez au prix conseillé",
    "product.livePrice": "prix du marché en direct",
    "product.valueFrom": "D'où vient la valeur",
    "grading.title": "Vaut-elle la gradation ?",
    "footer.notAdvice":
      "Ni conseil financier ni conseil de jeu. Les estimations comportent une marge d'erreur réelle — voir la",
    "footer.methodology": "méthodologie",
    "note.pricesUsd": "Prix affichés en dollars — la conversion en direct est indisponible.",
    "note.cardNames":
      "Les noms de cartes et de sets restent toujours dans leur langue d'origine, jamais traduits automatiquement.",
  },

  de: {
    "filter.cardLanguage": "Kartensprache",
    "nav.rankings": "Rangliste",
    "nav.collection": "Sammlung",
    "nav.methodology": "Methodik",
    "disclaimer.banner":
      "Zieh-Wahrscheinlichkeiten sind Community-Schätzungen, keine offiziellen Angaben — jeder Erwartungswert ist eine Prognose, kein Versprechen.",
    "rankings.title": "Rangliste versiegelter Produkte",
    "rankings.subtitle":
      "Erwartungswert beim Öffnen, aus Community-Zieh-Raten × aktuellen Kartenpreisen. Sets ohne belastbare Daten bleiben ausgeblendet.",
    "filter.sources": "Quellen",
    "filter.blend": "Mischung",
    "filter.show": "Anzeigen",
    "filter.graded": "Gegradet (PSA)",
    "filter.retail": "UVP",
    "filter.market": "Markt",
    "filter.sort": "Sortieren",
    "filter.search": "Set oder Produkt suchen…",
    "filter.allTypes": "Alle Produktarten",
    "filter.allGenerations": "Alle Generationen",
    "filter.anyConfidence": "Beliebige Verlässlichkeit",
    "filter.worthOpening": "Lohnt sich zu öffnen (+ROI)",
    "filter.shown": "angezeigt",
    "col.retail": "UVP",
    "col.market": "Markt",
    "col.avgUnbox": "Ø Öffnungswert",
    "col.roi": "ROI",
    "col.language": "Website-Sprache",
    "col.currency": "Währung",
    "product.expectedValue": "Erwartungswert",
    "product.retailMsrp": "UVP",
    "product.currentMarket": "Aktueller Markt",
    "product.ifRetail": "falls du es zum UVP findest",
    "product.livePrice": "aktueller Marktpreis",
    "product.valueFrom": "Woher der Wert kommt",
    "grading.title": "Lohnt sich das Graden?",
    "footer.notAdvice":
      "Keine Finanz- oder Glücksspielberatung. Schätzungen haben echte Fehlerspannen — siehe",
    "footer.methodology": "Methodik",
    "note.pricesUsd": "Preise in US-Dollar — die Live-Umrechnung ist derzeit nicht verfügbar.",
    "note.cardNames":
      "Karten- und Set-Namen erscheinen immer in ihrer Originalsprache, nie maschinell übersetzt.",
  },
} as const;

export type StringKey = keyof (typeof STRINGS)["en"];

export function translate(locale: Locale, key: StringKey): string {
  const table = STRINGS[locale] as Partial<Record<StringKey, string>>;
  return table[key] ?? STRINGS.en[key];
}
