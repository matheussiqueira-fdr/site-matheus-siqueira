// Lista os projetos do portfólio direto do GitHub, a cada requisição (com cache na borda).
//
// Regras:
// - Repositórios públicos (não fork) das contas em CONTAS aparecem sempre.
// - Repositórios privados só aparecem se tiverem o tópico "portfolio" no GitHub,
//   e só com nome, descrição, linguagem e link do site. O código nunca é exposto.
// - Privados exigem a variável de ambiente GITHUB_TOKEN na Vercel (token só de leitura
//   da conta dona dos repositórios). Sem ela, a página mostra apenas os públicos.

const CONTAS = ["matheussiqueira-fdr", "matheussiqueira-code"];
const TOPICO = "portfolio";
const OCULTOS = new Set(["site-matheus-siqueira"]);

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
  return {
    nome: repo.name,
    descricao: repo.description,
    linguagem: repo.language,
    site: repo.homepage || null,
    codigo: repo.private ? null : repo.html_url,
    privado: repo.private,
    estrelas: repo.stargazers_count,
    atualizado: repo.pushed_at || repo.updated_at,
    topicos: (repo.topics || []).filter((t) => t !== TOPICO),
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
