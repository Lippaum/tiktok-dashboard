import { fold } from "./util.js";

export const NICHE_OPTIONS = [
  { id: "ia", label: "IA" },
  { id: "terror", label: "Terror" },
  { id: "misterio", label: "Mistério" },
  { id: "curiosidades", label: "Curiosidades" },
  { id: "narracao", label: "Narração" },
  { id: "conversas", label: "Conversas" },
  { id: "memes", label: "Memes" },
  { id: "outros", label: "Outros" },
];

const NICHE_RULES = [
  {
    id: "ia",
    label: "IA",
    test: (text, tags) =>
      tags.has("ia") ||
      tags.has("inteligenciaartificial") ||
      tags.has("vozdeia") ||
      /inteligencia artificial|com ia|de ia|por ia|voz de ia|gerado por ia|feito com ia|imagem de ia|imagens de ia|animacao de ia/.test(text),
  },
  {
    id: "terror",
    label: "Terror",
    test: (text, tags) =>
      tags.has("terror") ||
      tags.has("historiasdeterror") ||
      tags.has("creepypasta") ||
      tags.has("historiareal") ||
      /historia de terror|creepypasta|historia real/.test(text),
  },
  {
    id: "misterio",
    label: "Mistério",
    test: (text, tags) => tags.has("misterio") || /misterio/.test(text),
  },
  {
    id: "curiosidades",
    label: "Curiosidades",
    test: (text, tags) =>
      tags.has("curiosidades") ||
      tags.has("fatoscuriosos") ||
      /fatos curiosos|voce sabia/.test(text),
  },
  {
    id: "narracao",
    label: "Narração",
    test: (text, tags) => tags.has("narracao") || /narrac|narrad/.test(text),
  },
  {
    id: "conversas",
    label: "Conversas",
    test: (text, tags) =>
      tags.has("conversasfakes") ||
      /conversa fake|conversas fake|chat fake|chat ficticio|conversa ficticia/.test(text),
  },
  {
    id: "memes",
    label: "Memes",
    test: (text, tags) => tags.has("meme") || tags.has("memes") || /\bmemes?\b/.test(text),
  },
];

function hasFaceSignal(text, tags) {
  return (
    tags.has("dance") ||
    tags.has("danca") ||
    tags.has("grwm") ||
    tags.has("maquiagem") ||
    /get ready with me|\bgrwm\b|dancinha|lip sync/.test(text)
  );
}

function hasAiSignal(text, tags) {
  return (
    tags.has("ia") ||
    tags.has("inteligenciaartificial") ||
    tags.has("vozdeia") ||
    /inteligencia artificial|com ia|de ia|por ia|voz de ia|gerado por ia|feito com ia/.test(text)
  );
}

/**
 * Heurística honesta: legenda, hashtags e, quando o actor manda, um sinal de
 * conteúdo gerado (isAigc / aigc). Não confirma que o vídeo é sem rosto.
 * Pontuação >= 2 marca a etiqueta.
 */
export function classify(item) {
  const tags = new Set((item.hashtags || []).map((tag) => fold(String(tag).replace(/^#/, ""))));
  const text = fold(item.caption);
  const reasons = [];
  let score = 0;

  const add = (points, label) => {
    score += points;
    if (!reasons.includes(label)) reasons.push(label);
  };

  if (item.aiMeta) add(4, "metadado de IA");
  if (tags.has("semrosto") || tags.has("faceless") || /sem rosto|faceless/.test(text)) {
    add(3, "sem rosto");
  }
  if (hasAiSignal(text, tags)) add(2, "IA na legenda ou hashtag");
  if (tags.has("narracao") || /narrac|narrad|voz de ia|voz sintetica|text to speech|\btts\b|elevenlabs/.test(text)) {
    add(2, "narração ou voz sintética");
  }
  if (/imagem de ia|imagens de ia|animacao de ia|midjourney|kling ai|\brunway\b/.test(text)) {
    add(2, "imagem ou animação de IA");
  }
  if (tags.has("conversasfakes") || /conversa fake|conversas fake|chat fake|chat ficticio|conversa ficticia/.test(text)) {
    add(2, "chat fictício");
  }
  if (tags.has("creepypasta") || tags.has("historiasdeterror") || /creepypasta|historia de terror/.test(text)) {
    add(1, "história de terror");
  }
  if (hasFaceSignal(text, tags)) {
    score -= 2;
    reasons.push("também tem sinal de rosto (dança/GRWM)");
  }

  const niches = NICHE_RULES.filter((rule) => rule.test(text, tags)).map(({ id, label }) => ({ id, label }));
  if (niches.length === 0) niches.push({ id: "outros", label: "Outros" });

  const faceless = score >= 2;
  return {
    faceless,
    facelessScore: score,
    facelessReasons: faceless ? reasons : [],
    niches,
  };
}
