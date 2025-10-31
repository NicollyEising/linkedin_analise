### **LinkedIn Analyzer**

---

#### **Descrição do Projeto**

O **LinkedIn Analyzer** é uma aplicação Node.js com interface web desenvolvida para análise de candidatos com base em descrições de vagas.
A ferramenta permite o envio de um arquivo CSV contendo perfis de candidatos e calcula a aderência de cada perfil conforme os critérios definidos pelo recrutador.

A aplicação combina processamento local em JavaScript com chamadas a uma API externa, apresentando visualmente os resultados e permitindo o download do ranking de candidatos em formato CSV.

---


#### **Como Usar**

Para iniciar o servidor local, utilize o comando:

```bash
node app.js
```

Após a execução, acesse a aplicação em:

```
http://localhost:3000
```

#### **Uso da Aplicação**

1. Preencha o formulário com os detalhes da vaga:

   * Grau de escolaridade
   * Conhecimentos obrigatórios e desejados
   * Tempo de experiência
   * Outras observações relevantes

2. Envie o arquivo CSV com os candidatos (deve conter ao menos as colunas `slug` e `name`).

3. Clique em **“Carregar Dataset”** e, em seguida, **“Analisar Todos os Perfis”**.

4. Aguarde o processamento.
   O sistema exibirá os **Top 5 candidatos**.
