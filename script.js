// -------------------------------------------------
// CONFIGURAÇÃO INICIAL E CONSTANTES GERAIS
// -------------------------------------------------

// Chave de API — utilizada para autenticar as requisições.
// OBS: jamais expor em produção, deve ser usada via proxy seguro.
const API_KEY = "mag_3ce2cc50c89d4088b2d4f938e97fc32d1515526"; 

// Endpoint da API responsável por processar perfis e retornar dados estruturados.
const ENDPOINT = "https://gw.magicalapi.com/profile-data";

// Cabeçalhos padrão para as requisições HTTP.
const HEADERS = {
    "Content-Type": "application/json",
    "api-key": API_KEY
};

// Número máximo de tentativas de polling para aguardar o resultado da API.
const MAX_ATTEMPTS = 20;

// Intervalo entre cada tentativa de polling (3 segundos).
const INTERVAL_SECONDS = 3 * 1000;

// Tempo máximo permitido para cada requisição individual (30 segundos).
const TIMEOUT_SECONDS = 30 * 1000;

// Variáveis globais: armazenam os candidatos carregados e os resultados.
let candidates = [];
let results = [];

// Modo de teste — se verdadeiro, o código usa dados simulados em vez de chamadas reais à API.
const MOCK_MODE = false;

// -------------------------------------------------
// FUNÇÃO: CRIAR JOB (inicia o processamento de um perfil na API)
// -------------------------------------------------

async function criarJob(payload) {
    console.log('🔄 Criando job:', payload);
    try {
        // Controlador para abortar a requisição se exceder o tempo limite.
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_SECONDS);
        
        // Envia requisição POST à API com o payload.
        const resp = await fetch(ENDPOINT, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        console.log('📤 Resposta criarJob:', resp.status, resp.statusText);
        let body;

        // Tenta converter a resposta em JSON. Se falhar, salva como texto cru.
        try {
            body = await resp.json();
        } catch {
            body = { raw_text: await resp.text() };
        }

        console.log('Body criarJob:', body);
        return { statusCode: resp.status, body };
    } catch (e) {
        console.error('Erro criarJob:', e.message);
        return { error: `network_error: ${e.message}` };
    }
}

// -------------------------------------------------
// FUNÇÃO: POLL RESULT (aguarda o processamento assíncrono do job)
// -------------------------------------------------

async function pollResult(requestId) {
    console.log('Polling para requestId:', requestId);
    const payload = { request_id: requestId };

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_SECONDS);
            
            const resp = await fetch(ENDPOINT, {
                method: 'POST',
                headers: HEADERS,
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            console.log(`Poll attempt ${attempt}:`, resp.status);
            let body;
            try {
                body = await resp.json();
            } catch {
                body = { raw_text: await resp.text() };
            }

            // Status HTTP — define o comportamento da próxima etapa.
            if (resp.status === 200) {
                console.log('Dados prontos!');
                return { status: 200, body };
            }
            if (resp.status === 201 || resp.status === 202) {
                console.log('Ainda processando...');
                await new Promise(resolve => setTimeout(resolve, INTERVAL_SECONDS));
                continue;
            }
            if (resp.status === 404) {
                console.log('404: Perfil não encontrado');
                return { status: 404, body };
            }
            if (resp.status === 401) {
                console.error('401: API Key inválida!');
                return { status: 401, body: { error: 'Invalid API Key' } };
            }
            if (resp.status === 429) {
                console.warn('429: Rate limit - aguardando...');
                await new Promise(resolve => setTimeout(resolve, INTERVAL_SECONDS * 2));
                continue;
            }

            console.warn(`Status inesperado: ${resp.status}`);
            return { status: resp.status, body };
        } catch (e) {
            console.error(`Poll erro (attempt ${attempt}):`, e.message);
            await new Promise(resolve => setTimeout(resolve, INTERVAL_SECONDS));
        }
    }

    console.error('Timeout no polling');
    return { status: "timeout", body: null };
}

// -------------------------------------------------
// FUNÇÃO: EXTRACT PROFILE DATA (obtém dados de um perfil LinkedIn)
// -------------------------------------------------

async function extractProfileData(slug) {
    if (MOCK_MODE) {
        // Retorna dados simulados, útil para testes sem API real.
        return {
            name: "Nicolly Munhoz",
            headline: "Web Developer | React | Java | Python | TypeScript",
            description: "Estudante de Engenharia de Software...",
            education: [{ degree: 'Bacharel em Engenharia de Software' }],
            skills: [{ name: 'React' }, { name: 'Java' }, { name: 'Python' }],
            experience: [{ duration_years: 2 }]
        };
    }

    // Três variantes possíveis para identificação do perfil.
    const variants = [
        { name: "slug", identifier: slug },
        { name: "url_no_www", identifier: `https://linkedin.com/in/${encodeURIComponent(slug)}` },
        { name: "url_www", identifier: `https://www.linkedin.com/in/${encodeURIComponent(slug)}` }
    ];

    for (const { name, identifier } of variants) {
        console.log(`Tentando variante ${name}: ${identifier}`);
        const payload = { profile_name: identifier };

        // Cria o job
        const created = await criarJob(payload);
        if (created.error) continue;
        if (created.statusCode !== 200 && created.statusCode !== 201) continue;

        const requestId = created.body?.data?.request_id;
        if (!requestId) continue;

        console.log('Request ID obtido:', requestId);
        const result = await pollResult(requestId);

        if (result.status === 200) {
            console.log('Sucesso na extração!');
            return result.body.data;
        } else if (result.status === 404) {
            console.log('404 nesta variante; tentando próxima...');
            continue;
        } else if (result.status === 401) {
            alert('Erro: API Key inválida!');
            return null;
        }
    }

    console.error('Falha em todas as variantes para slug:', slug);
    return null;
}

// -------------------------------------------------
// FUNÇÃO: EXTRAIR HABILIDADES DO TEXTO DO PERFIL
// -------------------------------------------------

function extractSkills(profileData) {
    const skills = new Set();

    const texts = [
        profileData.headline || '',
        profileData.description || '',
        ...(profileData.projects || []).map(p => p.description || p.name || '').join(' ')
    ].join(' ').toLowerCase();

    // Separadores comuns: "|" e ","
    const separators = [/\s*\|\s*/, /,\s*/];
    separators.forEach(sep => {
        texts.split(sep).forEach(word => {
            const clean = word.trim().replace(/[^\w\s]/g, '').toLowerCase();
            if (clean.length > 2 && !['and', 'the', 'for'].includes(clean)) {
                skills.add(clean);
            }
        });
    });

    // Palavras-chave conhecidas que devem ser detectadas mesmo sem separadores
    const knownSkills = ['java', 'react', 'python', 'javascript', 'typescript', 'flutter', 'opencv', 'machine learning', 'front-end', 'back-end', 'api'];
    knownSkills.forEach(skill => {
        if (texts.includes(skill)) skills.add(skill);
    });

    return Array.from(skills).map(s => ({ name: s }));
}

// -------------------------------------------------
// FUNÇÃO: INFERIR FORMAÇÃO ACADÊMICA (caso ausente)
// -------------------------------------------------

function inferDegree(profileData) {
    const texts = [profileData.headline || '', profileData.description || ''].join(' ').toLowerCase();

    if (profileData.education) {
        profileData.education.forEach(edu => {
            if (!edu.degree) {
                if (texts.includes('engenharia')) edu.degree = 'Engenharia de Software';
                else if (texts.includes('bacharel')) edu.degree = 'Bacharel';
            }
        });
    }
    return profileData;
}

// -------------------------------------------------
// FUNÇÃO: CALCULAR EXPERIÊNCIA A PARTIR DE PROJETOS
// -------------------------------------------------

function calculateExperienceFromProjects(profileData) {
    const currentYear = new Date().getFullYear();
    let totalYears = 0;

    (profileData.projects || []).forEach(proj => {
        const start = proj.date?.start_date;
        if (start) {
            let startYear = parseInt(start);
            if (isNaN(startYear) && start.includes(' ')) {
                startYear = parseInt(start.split(' ')[0].replace(/[^0-9]/g, '')) || currentYear;
            }
            const duration = currentYear - startYear;
            totalYears += Math.max(duration, 0);
        }
    });

    if ((profileData.experience || []).length === 0) {
        profileData.experience = [{ duration_years: totalYears }];
    } else {
        const existing = (profileData.experience || []).reduce((sum, exp) => sum + (exp.duration_years || 0), 0);
        profileData.experience[0].duration_years = existing + totalYears;
    }

    return profileData;
}

// -------------------------------------------------
// FUNÇÃO: CALCULAR ADERÊNCIA ENTRE PERFIL E VAGA
// -------------------------------------------------

function calculateAdherence(profileData, jobDesc) {
    const processedData = inferDegree(profileData);
    const dataWithExp = calculateExperienceFromProjects(processedData);
    const dataWithSkills = { ...dataWithExp, skills: extractSkills(dataWithExp) };

    let score = 0.0;
    const reasons = [];

    // (1) Escolaridade — peso 25%
    const requiredEdu = jobDesc.escolaridade.toLowerCase();
    const profileEdu = (dataWithSkills.education || []).map(edu => (edu.degree || '').toLowerCase()).filter(Boolean);
    const eduMatch = profileEdu.some(edu => edu.includes(requiredEdu) || requiredEdu.includes(edu));
    if (eduMatch) {
        score += 25;
        reasons.push(`Escolaridade compatível: ${requiredEdu}.`);
    } else {
        reasons.push(`Escolaridade parcial: requer ${requiredEdu}, encontrado ${profileEdu.join(', ') || 'nenhuma'}.`);
    }

    // (2) Conhecimentos obrigatórios — peso 30%
    const requiredSkills = jobDesc.conhecimentos_obrigatorios.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const profileSkills = (dataWithSkills.skills || []).map(s => (s.name || '').toLowerCase());
    const matches = requiredSkills.filter(req => profileSkills.some(skill => skill.includes(req) || req.includes(skill))).length;
    score += requiredSkills.length ? (matches / requiredSkills.length) * 30 : 0;
    reasons.push(`${matches}/${requiredSkills.length} conhecimentos obrigatórios atendidos.`);

    // (3) Conhecimentos desejados — peso 20%
    const desiredSkills = jobDesc.conhecimentos_desejados.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const matchesDesired = desiredSkills.filter(des => profileSkills.some(skill => skill.includes(des) || des.includes(skill))).length;
    score += desiredSkills.length ? (matchesDesired / desiredSkills.length) * 20 : 0;
    if (matchesDesired > 0) reasons.push(`${matchesDesired}/${desiredSkills.length} conhecimentos desejados atendidos.`);

    // (4) Experiência — peso 20%
    const requiredExpYears = parseFloat(jobDesc.tempo_experiencia) || 0;
    const totalExpYears = (dataWithSkills.experience || []).reduce((sum, exp) => sum + (exp.duration_years || 0), 0);
    score += requiredExpYears > 0 ? Math.min((totalExpYears / requiredExpYears) * 20, 20) : 20;
    reasons.push(`Experiência: ${totalExpYears.toFixed(1)} anos (requer ${requiredExpYears}).`);

    // (5) Outras observações — peso 5%
    const otherKeywords = jobDesc.outras_observacoes.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    const profileText = JSON.stringify(dataWithSkills).toLowerCase();
    const otherMatches = otherKeywords.filter(kw => profileText.includes(kw)).length;
    score += otherKeywords.length ? (otherMatches / otherKeywords.length) * 5 : 0;

    return { score: Math.round(score * 10) / 10, reason: reasons.join(' | ') };
}

// -------------------------------------------------
// EVENTO: CARREGAMENTO DO CSV DE CANDIDATOS
// -------------------------------------------------

document.getElementById('loadCsv').addEventListener('click', () => {
    const fileInput = document.getElementById('csvFile');
    const file = fileInput.files[0];
    if (!file) {
        alert('Selecione um arquivo CSV!');
        return;
    }

    // Usa PapaParse para ler o CSV de forma assíncrona.
    Papa.parse(file, {
        header: true,
        complete: (results) => {
            candidates = results.data.filter(row => row.slug);
            alert(`Dataset carregado: ${candidates.length} candidatos.`);
            document.getElementById('analyzeBtn').disabled = false;
        },
        error: (err) => alert(`Erro ao carregar CSV: ${err}`)
    });
});

// -------------------------------------------------
// EVENTO: INICIAR ANÁLISE DOS CANDIDATOS
// -------------------------------------------------

document.getElementById('analyzeBtn').addEventListener('click', async () => {
    if (candidates.length === 0) {
        alert('Carregue o dataset primeiro!');
        return;
    }

    // Coleta informações da vaga
    const jobForm = document.getElementById('jobForm');
    const jobDesc = {
        escolaridade: jobForm.escolaridade.value,
        conhecimentos_obrigatorios: jobForm.conhecimentos_obrigatorios.value,
        conhecimentos_desejados: jobForm.conhecimentos_desejados.value,
        tempo_experiencia: jobForm.tempo_experiencia.value,
        outras_observacoes: jobForm.outras_observacoes.value
    };

    results = [];

    // Exibe barra de progresso
    const progressSection = document.getElementById('progress');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    progressSection.style.display = 'block';
    document.getElementById('analyzeBtn').disabled = true;

    // Itera sobre todos os candidatos
    for (let i = 0; i < candidates.length; i++) {
        const row = candidates[i];
        const slug = row.slug;
        const name = row.name || slug;
        progressText.textContent = `Processando: ${name} (${i + 1}/${candidates.length})`;
        progressFill.style.width = `${((i + 1) / candidates.length) * 100}%`;

        let profileData = null;
        let attempts = 0;

        // Tenta extrair dados (até 2 tentativas)
        while (attempts < 2 && !profileData) {
            profileData = await extractProfileData(slug);
            attempts++;
            if (!profileData && attempts < 2) {
                console.log(`🔄 Retry ${attempts} para ${slug}`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        // Calcula pontuação de aderência
        if (profileData) {
            const { score, reason } = calculateAdherence(profileData, jobDesc);
            results.push({ name, slug, score, reason, profileData });
            console.log(`${name}: Score ${score}%`);
        } else {
            results.push({ name, slug, score: 0, reason: "Falha na extração de dados do perfil.", profileData: null });
            console.error(`${name}: Falha total`);
        }

        await new Promise(resolve => setTimeout(resolve, 3000));
    }

    progressSection.style.display = 'none';
    document.getElementById('analyzeBtn').disabled = false;

    // Ordena resultados por score decrescente
    results.sort((a, b) => b.score - a.score);

    // Exibe top 5
    const top5List = document.getElementById('top5List');
    top5List.innerHTML = '';
    results.slice(0, 5).forEach(row => {
        const card = document.createElement('div');
        card.className = 'candidate-card';
        card.innerHTML = `
            <h3>${row.name}</h3>
            <p><strong>Score:</strong> ${row.score}%</p>
            <p><strong>Slug:</strong> ${row.slug}</p>
            <p><strong>Motivo:</strong> ${row.reason}</p>
        `;
        top5List.appendChild(card);
    });

    document.getElementById('results').style.display = 'block';

    // Exibe JSON do primeiro candidato (debug)
    if (results[0]?.profileData) {
        document.getElementById('debugJson').textContent = JSON.stringify(results[0].profileData, null, 2);
        document.getElementById('debug').style.display = 'block';
    }

    // Gera CSV com resultados
    const csvContent = [
        ['name', 'slug', 'score', 'reason'],
        ...results.map(r => [r.name, r.slug, r.score, `"${r.reason.replace(/"/g, '""')}"`])
    ].map(row => row.join(',')).join('\n');

    // Configura botão de download
    document.getElementById('downloadBtn').onclick = () => {
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'resultados_aderencia.csv';
        a.click();
        URL.revokeObjectURL(url);
    };
});
