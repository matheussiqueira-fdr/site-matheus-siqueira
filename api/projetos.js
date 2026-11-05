// Lista os projetos do portfólio direto do GitHub, a cada requisição (com cache na borda).
//
// Regras:
// - Repositórios públicos (não fork) das contas em CONTAS aparecem sempre.
// - Repositórios privados só aparecem se tiverem o tópico "portfolio" no GitHub,
//   e só com nome, descrição, linguagem e link do site. O código nunca é exposto.
// - Privados exigem a variável de ambiente GITHUB_TOKEN na Vercel (token só de leitura
//   da conta dona dos repositórios). Sem ela, a página mostra apenas os públicos.
// - O link do site de um privado só sai com o tópico "demo-publica": ferramenta interna
//   não divulga o endereço da tela de login.
// - O tópico "destaque" coloca o projeto no topo da página.
// - Descrição no formato "Nome: texto" vira título e descrição do card.
// - Tópicos "ciclo-<etapa>" e "produto-proprio" dizem em que etapa do ciclo da home o
//   projeto entra; "jogo" põe o projeto no filtro de jogos.

const CONTAS = ["matheussiqueira-fdr", "matheussiqueira-code"];
const TOPICO = "portfolio";
const DEMO = "demo-publica";
const DESTAQUE = "destaque";
const JOGO = "jogo";
const OCULTOS = new Set(["site-matheus-siqueira"]);
const ETAPAS = {
  "ciclo-diagnostico": "1 · Diagnóstico",
  "ciclo-projeto": "2 · Projeto",
  "ciclo-captacao": "3 · Captação",
  "ciclo-governanca": "4 · Governança",
  "ciclo-execucao": "5 · Execução",
  "ciclo-prestacao-de-contas": "6 · Prestação de contas",
  "produto-proprio": "Produto próprio",
};
// Tópicos "stack-*" viram a linha de tecnologias do card (só o que foi confirmado no código).
const STACK = {
  "stack-nextjs": "Next.js",
  "stack-prisma": "Prisma",
  "stack-tailwind": "Tailwind",
  "stack-fastapi": "FastAPI",
  "stack-expo": "Expo",
  "stack-react-native": "React Native",
  "stack-javascript": "JavaScript",
  "stack-nodejs": "Node.js",
  "stack-express": "Express",
  "stack-supabase": "Supabase",
};

function separarNome(repo) {
  const texto = (repo.description || "").trim();
  const corte = texto.indexOf(": ");
  if (corte > 0 && corte <= 40) {
    const resto = texto.slice(corte + 2);
    return { titulo: texto.slice(0, corte), descricao: resto.charAt(0).toUpperCase() + resto.slice(1) };
  }
  return { titulo: repo.name.replace(/[-_]+/g, " "), descricao: texto || null };
}

async function github(path, token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "matheussiqueira2-portfolio",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (!response.ok) throw new Error(`GitHub ${response.status} em ${path}`);
  return response.json();
}

function resumo(repo) {
  const topicos = repo.topics || [];
  const { titulo, descricao } = separarNome(repo);
  const siteLiberado = !repo.private || topicos.includes(DEMO);
  // na ordem de STACK (framework antes de banco e estilo), não na ordem alfabética dos tópicos
  const stack = Object.keys(STACK).filter((t) => topicos.includes(t)).map((t) => STACK[t]);
  return {
    repo: repo.name,
    nome: titulo,
    descricao,
    linguagem: repo.language,
    stack: stack.length ? stack : repo.language ? [repo.language] : [],
    site: siteLiberado ? repo.homepage || null : null,
    codigo: repo.private ? null : repo.html_url,
    privado: repo.private,
    destaque: topicos.includes(DESTAQUE),
    jogo: topicos.includes(JOGO),
    etapa: ETAPAS[topicos.find((t) => ETAPAS[t])] || null,
    estrelas: repo.stargazers_count,
    atualizado: repo.pushed_at || repo.updated_at,
    topicos: topicos.filter((t) => ![TOPICO, DEMO, DESTAQUE, JOGO].includes(t) && !ETAPAS[t] && !STACK[t]),
  };
}

module.exports = async (req, res) => {
  const token = process.env.GITHUB_TOKEN;
  const vistos = new Map();

  // Públicos sem token: se o token expirar ou for trocado, a página continua com eles.
  const lotes = CONTAS.map((conta) =>
    github(`/users/${conta}/repos?per_page=100&type=owner&sort=pushed`)
  );
  if (token) {
    lotes.push(github("/user/repos?per_page=100&affiliation=owner&visibility=private", token));
  }

  const resultados = await Promise.allSettled(lotes);
  const falhas = resultados.filter((r) => r.status === "rejected");
  if (falhas.length === resultados.length) {
    res.status(502).json({
      erro: "Não foi possível consultar o GitHub.",
      avisos: falhas.map((f) => String(f.reason && f.reason.message)),
    });
    return;
  }

  let privadosRecebidos = 0;
  for (const resultado of resultados) {
    if (resultado.status !== "fulfilled") continue;
    for (const repo of resultado.value) {
      if (repo.private) privadosRecebidos += 1;
      if (repo.fork || OCULTOS.has(repo.name)) continue;
      if (repo.private && !(repo.topics || []).includes(TOPICO)) continue;

      const chave = repo.name.toLowerCase();
      const atual = vistos.get(chave);
      if (!atual || new Date(repo.pushed_at) > new Date(atual.atualizado)) {
        vistos.set(chave, resumo(repo));
      }
    }
  }

  const projetos = [...vistos.values()].sort(
    (a, b) => new Date(b.atualizado) - new Date(a.atualizado)
  );

  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
  // Só o motivo da falha (ex.: "GitHub 401 em /user/repos..."), nunca o token.
  const avisos = falhas.map((f) => String(f.reason && f.reason.message));
  res.status(200).json({ projetos, comToken: Boolean(token), privadosRecebidos, avisos });
};
