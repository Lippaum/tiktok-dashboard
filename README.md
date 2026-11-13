# Radar Viral

Painel estático dos TikToks que mais crescem no **Brasil**, com um filtro para formatos sem rosto e feitos com IA (narração, imagem, terror, curiosidade, voz sintética, chat fictício, meme). O site é só HTML: a coleta roda no GitHub Actions, grava `data/videos.json` e publica em [https://lippaum.github.io/tiktok-dashboard/](https://lippaum.github.io/tiktok-dashboard/).

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
11. Clique na aba **Actions**, abra o workflow **Publicar site**, clique em **Run workflow**, deixe a branch **main** e confirme. Espere o sinal verde. O endereço é [https://lippaum.github.io/tiktok-dashboard/](https://lippaum.github.io/tiktok-dashboard/). Antes da primeira coleta, a página mostra o aviso de que ainda não há vídeos.
12. Ainda em **Actions**, abra **Coletar TikTok**, clique em **Run workflow**, branch **main**, e confirme. A primeira execução manual é necessária; depois ela se repete sozinha.
13. Quando **Coletar TikTok** terminar em verde, o site é publicado de novo, já com os vídeos. A repetição automática é a cada 4 horas.

Se o workflow ficar vermelho logo no passo do segredo, o nome não é exatamente `APIFY_TOKEN` ou o secret ainda não foi salvo. Se a Apify responder 401, o token está errado. Se responder 402, o crédito de US$ 5 do mês acabou.

## Custo na Apify

Conta grátis: **US$ 5 de crédito por mês**. Os dois actors abaixo, no plano Free, custam **US$ 0,25 por 1.000 resultados** (tabela do autor, conferida em 13 de novembro de 2026). Busca vazia não é cobrada e não há taxa extra de proxy. O preço “a partir de US$ 0,18” vale para planos pagos mais altos, não para o crédito grátis.

A agenda `0 */4 * * *` dispara **6 vezes por dia × 30 = 180 coletas por mês**. Cada coleta pede, no máximo:

| Fonte | Pedido |
| --- | --- |
| Feed em alta, região BR | 15 vídeos |
| Busca, 5 hashtags em rodízio × 4 vídeos | 20 vídeos |
| **Total por coleta** | **35 resultados** |

Teto do mês: 180 × 35 = **6.300 resultados × US$ 0,00025 ≈ US$ 1,58**. Uma coleta manual extra custa cerca de **US$ 0,009**. O coletor recusa a configuração se a estimativa passar de **US$ 4**, para sobrar folga dentro dos US$ 5.

As 11 hashtags não são buscadas todas de uma vez. Cada coleta leva 5, em rodízio, e em três coletas (12 horas) a lista inteira passa. Se você mudar `keywordsPerRun` para 11 e mantiver o resto, o teto sobe para cerca de **US$ 2,66/mês** (15 + 44 vídeos × 180). Dá para fazer, mas o padrão fica mais barato.

O custo real segue quantos itens a Apify devolver, não o teto. O log do workflow imprime a estimativa daquela execução.

## Por que estes actors

Conferido na Apify em 13 de novembro de 2026:

- [`kaitoeasyapi/tiktok-trending-feed-scraper`](https://apify.com/kaitoeasyapi/tiktok-trending-feed-scraper) aceita `regions: ["BR"]` e `maxVideosPerRegion`. A página lista o Brasil entre os países. Entrada usada: `{ "regions": ["BR"], "maxVideosPerRegion": 15 }`.
- [`kaitoeasyapi/tiktok-search-scraper`](https://apify.com/kaitoeasyapi/tiktok-search-scraper) aceita hashtag ou frase em `keywords`, e tem o campo `region` com `BR` na documentação. Também filtra data e ordenação sem taxa extra. Entrada usada: `region: "BR"`, `sortType: "1"` (mais curtidos), `publishTime: "7"` (esta semana), `maxResultsPerKeyword: 4`. O feed em alta mostra o que está bombando agora; a busca semanal traz formatos do nicho; o histórico entre coletas mostra quais ainda estão subindo.

Não entrou:

- `clockworks/tiktok-scraper` chega a cerca de **US$ 3,70 por 1.000** no plano Free. A mesma carga de 6.300 resultados passaria de **US$ 23**, acima do crédito. O campo `proxyCountryCode: "BR"` só escolhe o país do proxy (os proxies do Brasil voltaram a funcionar em fevereiro de 2026); não é um filtro de região da busca.
- `kaitoeasyapi/tiktok-hashtag-scraper` é barato, mas o input só tem `hashtags` e `maxVideosPerHashtag`. Sem país, não dá para fixar o Brasil.

Esses actors da Kaito ainda têm poucos usuários. O schema publicado de saída é só “um dataset”. O coletor lê os campos citados no README deles (`playCount`, `diggCount`, `commentCount`, `shareCount`, autor, `videoUrlNoWatermark`) e também o JSON cru do TikTok e o formato achatado de outros scrapers. Se uma coleta voltar sem vídeo identificável, o workflow falha e **não apaga** o `videos.json` anterior.

## O que o painel calcula

- **Visualizações/hora:** visualizações ÷ horas desde a publicação, na hora da coleta. Abaixo de 1 minuto, conta 1 minuto, para um vídeo recém-postado não estourar a conta.
- **Crescimento:** visualizações a mais desde a coleta anterior em que o vídeo apareceu. Na primeira vez em que ele entra, o painel diz “primeira coleta”.
- **Engajamento:** (curtidas + comentários + compartilhamentos) ÷ visualizações.
- **Duração, data e seguidores** do autor, quando o actor manda.
- **Sem rosto/IA:** heurística por legenda, hashtags e, se vier, um metadado de conteúdo gerado (`isAigc` e parecidos). A nota no site deixa isso explícito: não é uma confirmação.
- **Nicho:** outra heurística, pelos mesmos textos. Um vídeo pode ter mais de um.

Os números ficam em `data/videos.json`. Cada coleta também grava `data/snapshots/AAAA-MM-DDTHH.json` (hora UTC). O repositório guarda as últimas **42** coletas, cerca de 7 dias, e apaga as mais antigas.

## Rodar o exemplo neste computador

Não precisa de token.

```bash
npm test
npm run demo
```

O segundo comando sobe o painel em `http://127.0.0.1:4173/` com dez vídeos fictícios, duas ou três coletas de intervalo e o aviso de que são dados de exemplo. Os arquivos vão para `.demo-data/`, que não entra no git. A pasta `data/` continua vazia até a coleta real.

Para uma coleta de verdade na sua máquina:

```bash
cp .env.example .env
# edite .env e coloque APIFY_TOKEN=...  (o arquivo .env está no .gitignore)
npm run collect
```

## Ajustar a lista e os limites

Tudo que muda o gasto está em `config/sources.json`: hashtags, `keywordsPerRun`, `maxResultsPerKeyword`, `maxVideosPerRegion`, o teto `monthlyBudgetUsd` e o preço `pricePerThousandUsd`. Se trocar o cron em `.github/workflows/collect.yml`, atualize também `scheduleCron`, `intervalHours` e `expectedRunsPerMonth`, senão o teto de custo mente.

`sortType` na busca: `"0"` relevância, `"1"` mais curtidos, `"3"` mais recentes. `publishTime`: `"1"` últimas 24 horas, `"7"` esta semana, `"30"` este mês.
