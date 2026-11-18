import { fold } from "./util.js";

export const NICHE_OPTIONS = [
  { id: "ia", label: "IA" },
  { id: "terror", label: "Terror" },
  { id: "misterio", label: "Mistério" },
  { id: "curiosidades", label: "Curiosidades" },
  { id: "narracao", label: "Narração" },
  { id: "conversas", label: "Conversas" },
  { id: "historias", label: "Histórias" },
  { id: "memes", label: "Memes" },
  { id: "outros", label: "Outros" },
];

const AI_TAGS = new Set([
  "ia",
  "inteligenciaartificial",
  "vozdeia",
  "aitrend",
  "aifruitstories",
  "frutasia",
  "frutinovelas",
  "novelinhasdasfrutas",
  "smartbot",
  "robotvibes",
  "iagenerativa",
  "feitoia",
  "feitocomia",
]);

const CHAT_TAGS = new Set([
  "conversasfakes",
  "conversafake",
  "conversasdowhatsapp",
  "conversasdewhats",
  "conversasdowhats",
  "chatfake",
  "textstory",
]);

const SPORTS_TAGS = new Set([
  "futebol",
  "editfootball",
  "premierleague",
  "championsleague",
  "brasileirao",
  "libertadores",
  "defesasdegoleiro",
  "selecaobrasileira",
  "vinijr",
  "neymar",
]);

function hasSportsSignal(text, tags) {
  for (const tag of SPORTS_TAGS) {
    if (tags.has(tag)) return true;
  }
  return /\b(futebol|goleiro|golaco|premier league|champions league|libertadores|brasileirao|selecao brasileira)\b/.test(
    text,
  );
}

function hasFaceSignal(text, tags) {
  return (
    tags.has("dance") ||
    tags.has("danca") ||
    tags.has("grwm") ||
    tags.has("maquiagem") ||
    tags.has("lipsync") ||
    /\b(get ready with me|grwm|dancinha|lip sync)\b/.test(text)
  );
}

function hasAiCreatorSignal(creator) {
  if (!creator) return false;
  return (
    /\bplotia\b|\baifruit\w*|\bfrutti\.ia\w*/.test(creator) ||
    /(?:^|[.\-_ ])ia(?:$|[.\-_ ])/.test(creator)
  );
}

function hasAiSignal(text, creator, tags) {
  for (const tag of AI_TAGS) {
    if (tags.has(tag)) return true;
  }
  if (hasAiCreatorSignal(creator)) return true;
  return /\b(inteligencia artificial|com ia|de ia|por ia|voz de ia|gerad[oa]s? por ia|feit[oa]s? com ia|ia generativa|video de ia)\b/.test(
    text,
  );
}

function hasChatSignal(text, creator, tags) {
  for (const tag of CHAT_TAGS) {
    if (tags.has(tag)) return true;
  }
  return /\b(conversa\w* fake\w*|conversa\w* falsa\w*|chat fake|chat ficticio|conversa\w* ficticia\w*|conversa\w* d[eo] whats\w*)\b/.test(
    `${text} ${creator}`,
  );
}

const NICHE_RULES = [
  {
    id: "ia",
    label: "IA",
    test: (text, creator, tags) =>
      hasAiSignal(text, creator, tags) ||
      /\b(imagem de ia|imagens de ia|animacao de ia|midjourney|kling ai|runway|sora ai|frutinovela\w*)\b/.test(
        `${text} ${creator}`,
      ),
  },
  {
    id: "terror",
    label: "Terror",
    test: (text, creator, tags) =>
      tags.has("terror") ||
      tags.has("historiasdeterror") ||
      tags.has("relatosdeterror") ||
      tags.has("creepypasta") ||
      tags.has("paranormal") ||
      tags.has("assombrado") ||
      tags.has("exorcismo") ||
      /\b(historia\w* de terror|relato\w* de terror|creepypasta|caso de exorcismo|assombrac\w*|sobrenatural)\b/.test(
        `${text} ${creator}`,
      ),
  },
  {
    id: "misterio",
    label: "Mistério",
    test: (text, creator, tags) =>
      tags.has("misterio") ||
      tags.has("misterios") ||
      tags.has("casosmisteriosos") ||
      tags.has("casoscriminais") ||
      tags.has("casoscrimimais") ||
      tags.has("enigmas") ||
      /\b(misterio\w*|caso\w* criminal\w*|crimes? falados|enigma\w*)\b/.test(`${text} ${creator}`),
  },
  {
    id: "curiosidades",
    label: "Curiosidades",
    test: (text, creator, tags) =>
      tags.has("curiosidade") ||
      tags.has("curiosidades") ||
      tags.has("fatoscuriosos") ||
      tags.has("vocesabia") ||
      tags.has("quiz") ||
      /\b(curiosidade\w*|fatos? curioso\w*|voce sabia|tudoem60)\b/.test(`${text} ${creator}`),
  },
  {
    id: "narracao",
    label: "Narração",
    test: (text, creator, tags, sports) =>
      !sports &&
      (tags.has("narracao") ||
        tags.has("historianarrada") ||
        tags.has("redditstories") ||
        /\b(narrac\w*|narrad\w*|historia\w* do reddit)\b/.test(`${text} ${creator}`)),
  },
  {
    id: "conversas",
    label: "Conversas",
    test: (text, creator, tags) => hasChatSignal(text, creator, tags),
  },
  {
    id: "historias",
    label: "Histórias",
    test: (text, creator, tags) =>
      tags.has("historias") ||
      tags.has("historia") ||
      tags.has("historiareal") ||
      tags.has("historiasreais") ||
      tags.has("casosreais") ||
      tags.has("novelinhas") ||
      tags.has("frutinovelas") ||
      tags.has("reflexao") ||
      tags.has("reflita") ||
      /\b(olha essa historia|historia real|historia\w* emocionante\w*|novelinha\w*|li[c]ao de vida|reflexao)\b/.test(
        `${text} ${creator}`,
      ),
  },
  {
    id: "memes",
    label: "Memes",
    test: (text, creator, tags) =>
      tags.has("meme") ||
      tags.has("memes") ||
      tags.has("humor") ||
      tags.has("comedia") ||
      tags.has("humornordestino") ||
      tags.has("brainrot") ||
      /\b(memes?|humor|comedia)\b/.test(`${text} ${creator}`),
  },
];

export function detectLanguage(item = {}) {
  const rawCaption = String(item.caption || "");
  const rawCreator = `${item.author || ""} ${item.authorName || ""}`;
  const rawCombined = `${rawCaption} ${rawCreator}`;
  const tags = new Set((item.hashtags || []).map((tag) => fold(String(tag).replace(/^#/, ""))));
  const folded = fold(`${rawCaption} ${Array.from(tags).join(" ")} ${rawCreator}`);

  if (/[\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Thai}\p{Script=Hangul}\p{Script=Han}]/u.test(rawCaption)) {
    return "other";
  }
  if (!folded.replace(/[^a-z]/g, "")) return "unknown";

  let pt = 0;
  let es = 0;
  let en = 0;

  if (/[ãõç]/i.test(rawCombined)) pt += 4;
  if (/[¿¡ñ]/i.test(rawCombined)) es += 4;
  if (/\b\w+cion\b/.test(folded) && !/[ãõç]/i.test(rawCombined)) es += 2;
  if (/\b\w+coes\b|\b\w+cao\b/.test(folded) && /[ãõç]/i.test(rawCombined)) pt += 2;

  const ptWords =
    /\b(voce|voces|nao|entao|tambem|porque|quando|isso|essa|esse|muito|minha|meu|ninguem|alguem|sera|estava|ficou|olhar|historia\w* de terror|fatos curiosos|conversas? d[eo] whats\w*|novelinha\w*|frutinovela\w*|brasil|brasileir\w*|vaiprofy\w*|fypbr)\b/g;
  const esWords =
    /\b(el|la|los|las|una|unos|unas|ellos|ellas|juran|tienen|estan|pero|nadie|alguien|desaparecio|policia|salieron|comenzo|miedo|nino|anos|despues|volvio|acertijo|retomental|miedoyterror|historiasreales|lashistoriastiktok|mexico|argentina|colombia|chile|apagaran|todos los|por darle)\b/g;
  const enWords =
    /\b(the|this|that|with|from|what|your|they|have|just|about|love|wins|never|storytime|uktiktok|cameluk|camellife|hollywoodedits|moviescenes|villagelife|animallover|trendingnow|explorepage)\b/g;

  pt += (folded.match(ptWords) || []).length * 2;
  es += (folded.match(esWords) || []).length * 2;
  en += (folded.match(enWords) || []).length * 2;

  if (
    tags.has("brasil") ||
    tags.has("tiktokbrasil") ||
    tags.has("fybrasil") ||
    tags.has("fatoscuriosos") ||
    tags.has("historiasdeterror") ||
    tags.has("conversasfakes") ||
    tags.has("conversasdowhatsapp")
  ) {
    pt += 3;
  }
  if (tags.has("mexico") || tags.has("parati") || tags.has("historiasreales") || tags.has("acertijo")) {
    es += 2;
  }
  if (tags.has("uktiktok") || tags.has("cameluk") || tags.has("moviescenes")) {
    en += 3;
  }

  if (pt >= 2 && pt >= es && pt >= en) return "pt";
  if (es >= 2 && pt === 0 && en === 0) return "es";
  if (es >= 3 && es > pt && es >= en) return "es";
  if (en >= 2 && pt === 0 && es === 0) return "en";
  if (en >= 3 && en > pt && en > es) return "en";
  if (pt >= 1 && es === 0 && en === 0) return "pt";
  return "unknown";
}

export function classify(item = {}) {
  const tags = new Set((item.hashtags || []).map((tag) => fold(String(tag).replace(/^#/, ""))));
  const text = fold(item.caption);
  const creator = fold(`${item.author || ""} ${item.authorName || ""}`);
  const sports = hasSportsSignal(`${text} ${creator}`, tags);
  const reasons = [];
  let score = 0;

  const add = (points, label) => {
    score += points;
    if (!reasons.includes(label)) reasons.push(label);
  };

  if (item.aiMeta) add(4, "metadado de IA");
  if (
    tags.has("semrosto") ||
    tags.has("faceless") ||
    tags.has("canaldark") ||
    tags.has("contadark") ||
    /\b(sem rosto|faceless|canal dark|conta dark)\b/.test(`${text} ${creator}`)
  ) {
    add(3, "sem rosto");
  }
  if (hasAiSignal(text, creator, tags)) add(2, "IA na legenda ou hashtag");
  if (
    !sports &&
    (tags.has("narracao") ||
      tags.has("historianarrada") ||
      tags.has("redditstories") ||
      /\b(narrac\w*|narrad\w*|voz de ia|voz sintetica|text to speech|tts|elevenlabs)\b/.test(
        `${text} ${creator}`,
      ))
  ) {
    add(2, "narração ou voz sintética");
  }
  if (
    tags.has("animacao") ||
    tags.has("animation") ||
    tags.has("frutinovelas") ||
    tags.has("novelinhasdasfrutas") ||
    tags.has("aifruitstories") ||
    /\b(imagem de ia|imagens de ia|animacao de ia|animacao 3d|construindo3d|midjourney|kling ai|runway|sora ai|frutinovela\w*)\b/.test(
      `${text} ${creator}`,
    )
  ) {
    add(2, "imagem ou animação de IA");
  }
  if (hasChatSignal(text, creator, tags)) {
    add(2, "chat fictício");
  }
  if (
    tags.has("quiz") ||
    tags.has("perguntaserespostas") ||
    /\b(comente a,? b ou c|voce consegue acertar)\b/.test(text)
  ) {
    add(2, "formato quiz");
  }
  if (
    tags.has("creepypasta") ||
    tags.has("historiasdeterror") ||
    tags.has("relatosdeterror") ||
    /\b(creepypasta|historia\w* de terror|relato\w* de terror)\b/.test(text)
  ) {
    add(1, "história de terror");
  }
  if (
    tags.has("fatoscuriosos") ||
    tags.has("vocesabia") ||
    /\b(voce sabia|fatos? curioso\w*|curiosidades do dia|crimesfalados|misterios news)\b/.test(
      `${text} ${creator}`,
    )
  ) {
    add(1, "formato de curiosidade/caso");
  }

  if (hasFaceSignal(text, tags)) {
    score -= 2;
    reasons.push("também tem sinal de rosto (dança/GRWM)");
  } else if (sports) {
    score -= 2;
    reasons.push("corte esportivo");
  }

  const niches = NICHE_RULES.filter((rule) => rule.test(text, creator, tags, sports)).map(
    ({ id, label }) => ({ id, label }),
  );
  if (niches.length === 0) niches.push({ id: "outros", label: "Outros" });

  const faceless = score >= 2;
  const language = detectLanguage(item);
  return {
    faceless,
    facelessScore: score,
    facelessReasons: faceless ? reasons : [],
    niches,
    language,
  };
}
