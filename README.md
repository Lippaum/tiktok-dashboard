# Radar Viral

Painel estático dos TikToks que mais crescem no **Brasil**, com foco em formatos replicáveis sem rosto e feitos com IA (narração, imagem, animação 3D, terror, curiosidade, voz sintética, chat fictício, histórias e meme). O site é estático: a coleta roda no GitHub Actions, grava `data/videos.json` e publica em [https://lippaum.github.io/tiktok-dashboard/](https://lippaum.github.io/tiktok-dashboard/).

Não há servidor seu. O token da Apify fica só no segredo do GitHub. Este repositório não tem token e o modo de exemplo não chama a Apify.

## O que clicar para ir ao ar

Faça isto depois de mesclar o pull request na branch `main`.

1. Abra o repositório no GitHub e clique em **Settings**.
2. No menu da esquerda, clique em **Secrets and variables** e depois em **Actions**.
3. Clique em **New repository secret**.
4. Em **Name**, escreva exatamente `APIFY_TOKEN`.
5. Em **Secret**, cole o token da API. Para copiar o token, abra [console.apify.com/settings/integrations](https://console.apify.com/settings/integrations) na sua conta Apify. Não coloque esse valor em arquivo nenhum do repositório.
6. Clique em **Add secret**.
7. Ainda em **Settings**, clique em **Actions** e depois em **General**.
8. Em **Workflow permissions**, marque **Read and write permissions** e clique em **Save**. Sem isso o workflow não consegue gravar os JSON no repositório.
9. Ainda em **Settings**, clique em **Pages**.
10. Em **Build and deployment**, no campo **Source**, escolha **GitHub Actions**. Se essa opção ainda não aparecer, faça o passo 11 primeiro e volte aqui.
11. Clique na aba **Actions**, abra o workflow **Publicar site**, clique em **Run workflow**, deixe a branch **main** e confirme. Espere o sinal verde. O endereço é [https://lippaum.github.io/tiktok-dashboard/](https://lippaum.github.io/tiktok-dashboard/).
12. Ainda em **Actions**, abra **Coletar TikTok**, clique em **Run workflow**, branch **main**, e confirme. A primeira execução manual é necessária; depois ela se repete sozinha.
13. Quando **Coletar TikTok** terminar em verde, o site é publicado de novo, já com os vídeos. A repetição automática é a cada 4 horas.

Se o workflow ficar vermelho logo no passo do segredo, o nome não é exatamente `APIFY_TOKEN` ou o secret ainda não foi salvo. Se a Apify responder 401, o token está errado. Se responder 402, o crédito de US$ 5 do mês acabou.

## Custo na Apify

Conta grátis: **US$ 5 de crédito por mês**. Os dois actors abaixo, no plano Free, custam **US$ 0,25 por 1.000 resultados** (tabela do autor, conferida em 13 de novembro de 2026). Busca vazia não é cobrada e não há taxa extra de proxy.

A agenda `0 */4 * * *` dispara **6 vezes por dia × 30 = 180 coletas por mês**. Cada coleta pede, no máximo:

| Fonte | Pedido |
| --- | --- |
| Feed em alta, região BR | 15 vídeos |
| Busca, 5 termos PT-BR em rodízio × 4 vídeos | 20 vídeos |
| **Total por coleta** | **35 resultados** |

Teto do mês: 180 × 35 = **6.300 resultados × US$ 0,00025 ≈ US$ 1,58**. Uma coleta manual extra custa cerca de **US$ 0,009**. O coletor recusa a configuração se a estimativa passar de **US$ 4**, para sobrar folga dentro dos US$ 5.

As 15 buscas ancoradas em português passam 5 por vez, guiadas pelo cursor do último snapshot salvo (assim nenhuma fatia é pulada caso o agendador do GitHub Actions atrase), alternando janelas de **7 dias** e **24 horas** (`publishTimes: ["7", "1", "7"]`) para capturar tanto líderes da semana quanto virais recém-nascidos.

## Por que estes actors

- [`kaitoeasyapi/tiktok-trending-feed-scraper`](https://apify.com/kaitoeasyapi/tiktok-trending-feed-scraper): aceita `regions: ["BR"]` e `maxVideosPerRegion: 15`.
- [`kaitoeasyapi/tiktok-search-scraper`](https://apify.com/kaitoeasyapi/tiktok-search-scraper): aceita frase ou hashtag em `keywords`, `region: "BR"`, ordenação e janela de publicação sem taxa extra.

## O que o painel calcula e entrega

- **Explosão (`breakoutScore`):** combina velocidade por hora (`growthPerHour` ou `viewsPerHour`), salto percentual entre coletas, engajamento, bônus para vídeos recentes (≤ 72h), foco em português e decaimento para vídeos que sumiram das coletas há mais de 12h.
- **Crescimento/hora:** visualizações ganhas ÷ horas exatas entre as duas últimas aparições do vídeo, ajustado pelo frescor da última leitura.
- **Visualizações/hora:** visualizações ÷ horas desde a publicação, medidas na última leitura do vídeo.
- **Engajamento:** `(curtidas + comentários + compartilhamentos + salvamentos) ÷ visualizações`.
- **Idioma / Foco Brasil:** detector leve (`pt`, `es`, `en`, `other`, `unknown`) para filtrar vídeos estrangeiros que furam a busca regional.
- **Sem rosto/IA e Nichos:** heurística por legenda, hashtags, nome/arroba do criador e metadado `isAigc`.
- **Capas sem erro 403:** o workflow guarda miniaturas no cache do GitHub Actions (`.cover-cache`, sem inflar o histórico Git) e o painel verifica o `x-expires` antes de requisitar URLs antigas do CDN do TikTok, exibindo artes vetoriais do nicho quando o link externo já expirou.
- **Ferramentas de modelagem no navegador:** busca rápida (`/`), filtros sincronizados na URL, legenda completa expandível, cópia de gancho, favoritos salvos localmente (`localStorage`) e exportação em CSV.

## Comandos locais

Não precisa de token para testar nem para recalcular os snapshots já existentes:

```bash
npm test          # roda a suíte de testes automatizados
npm run demo      # sobe o painel de exemplo em http://127.0.0.1:4173/
npm run rebuild   # recalcula data/videos.json a partir de data/snapshots/
npm run build     # monta o site estático final em _site/
```

Para uma coleta real na sua máquina:

```bash
cp .env.example .env
# edite .env e coloque APIFY_TOKEN=...  (o arquivo .env está no .gitignore)
npm run collect
```

## Ajustar a lista e os limites

Tudo que muda o gasto está em `config/sources.json`: buscas, `keywordsPerRun`, `maxResultsPerKeyword`, `maxVideosPerRegion`, `publishTimes`, o teto `monthlyBudgetUsd` e o preço `pricePerThousandUsd`. Se trocar o cron em `.github/workflows/collect.yml`, atualize também `scheduleCron`, `intervalHours` e `expectedRunsPerMonth`.
