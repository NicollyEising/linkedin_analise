  // -------------------------------------------------
        // CONFIGURAÇÃO: API
        const API_KEY = "mag_3ce2cc50c89d4088b2d4f938e97fc32d1515526"; // ATENÇÃO: Exposta! Use proxy em produção
        const ENDPOINT = "https://gw.magicalapi.com/profile-data";
        const HEADERS = {
            "Content-Type": "application/json",
            "api-key": API_KEY
        };
        const MAX_ATTEMPTS = 20;
        const INTERVAL_SECONDS = 3 * 1000; // ms
        const TIMEOUT_SECONDS = 30 * 1000; // ms
        let candidates = []; // Armazena o dataset carregado
        let results = []; // Armazena resultados

        // MOCK MODE: Descomente para simular dados (útil para testes sem API)
        const MOCK_MODE = false; // true para mock, false para API real
        // -------------------------------------------------

        // Funções de API (portadas do Python) com debug
        async function criarJob(payload) {
            console.log('🔄 Criando job:', payload);
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
                
                console.log('📤 Resposta criarJob:', resp.status, resp.statusText);
                let body;
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

        async function extractProfileData(slug) {
            if (MOCK_MODE) {
                // MOCK: Simula dados para testes
                return {
                    name: "Nicolly Munhoz",
                    headline: "Web Developer | React | Java, C++ | Python | TypeScript | JavaScript | Flutter",
                    description: "Estudante de Engenharia de Software...",
                    education: [{ degree: 'Bacharel em Engenharia de Software' }],
                    skills: [{ name: 'React' }, { name: 'Java' }, { name: 'Python' }],
                    experience: [{ duration_years: 2 }]
                };
            }

            const variants = [
                { name: "slug", identifier: slug },
                { name: "url_no_www", identifier: `https://linkedin.com/in/${encodeURIComponent(slug)}` },
                { name: "url_www", identifier: `https://www.linkedin.com/in/${encodeURIComponent(slug)}` }
            ];

            for (const { name, identifier } of variants) {
                console.log(`Tentando variante ${name}: ${identifier}`);
                const payload = { profile_name: identifier };
                const created = await criarJob(payload);
                if (created.error) {
                    console.error(`Erro na variante ${name}:`, created.error);
                    continue;
                }

                if (created.statusCode !== 200 && created.statusCode !== 201) {
                    console.error(`Status criarJob inválido: ${created.statusCode}`);
                    continue;
                }

                const requestId = created.body?.data?.request_id;
                if (!requestId) {
                    console.error('Sem request_id retornado');
                    continue;
                }

                console.log('Request ID obtido:', requestId);
                const result = await pollResult(requestId);
                if (result.status === 200) {
                    console.log('Sucesso na extração!');
                    // CORREÇÃO: Retornar apenas .data do body
                    return result.body.data;
                } else if (result.status === 404) {
                    console.log('404 nesta variante; tentando próxima...');
                    continue;
                } else if (result.status === 401) {
                    alert('Erro: API Key inválida! Verifique a chave.');
                    return null;
                }
            }
            console.error('Falha em todas as variantes para slug:', slug);
            return null;
        }

        // NOVA FUNÇÃO: Extrair skills do headline e description
        function extractSkills(profileData) {
            const skills = new Set();
            const texts = [
                profileData.headline || '',
                profileData.description || '',
                ...(profileData.projects || []).map(p => p.description || p.name || '').join(' ')
            ].join(' ').toLowerCase();

            // Split por |, , e palavras comuns de skills
            const separators = [/\s*\|\s*/, /,\s*/];
            separators.forEach(sep => {
                texts.split(sep).forEach(word => {
                    const clean = word.trim().replace(/[^\w\s]/g, '').toLowerCase();
                    if (clean.length > 2 && !['and', 'the', 'for'].includes(clean)) {
                        skills.add(clean);
                    }
                });
            });

            // Skills específicas conhecidas (expandir se necessário)
            const knownSkills = ['java', 'react', 'python', 'javascript', 'typescript', 'flutter', 'opencv', 'machine learning', 'front-end', 'back-end', 'api'];
            knownSkills.forEach(skill => {
                if (texts.includes(skill)) skills.add(skill);
            });

            return Array.from(skills).map(s => ({ name: s }));
        }

        // NOVA FUNÇÃO: Inferir degree se null
        function inferDegree(profileData) {
            const texts = [profileData.headline || '', profileData.description || ''].join(' ').toLowerCase();
            if (profileData.education) {
                profileData.education.forEach(edu => {
                    if (!edu.degree) {
                        if (texts.includes('engenharia')) edu.degree = 'Engenharia de Software';
                        else if (texts.includes('bacharel')) edu.degree = 'Bacharel';
                        // Adicionar mais inferências se necessário
                    }
                });
            }
            return profileData;
        }

        // NOVA FUNÇÃO: Calcular experiência de projects (já que experience pode estar vazio)
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
            // Se experience vazio, usar isso como proxy
            if ((profileData.experience || []).length === 0) {
                profileData.experience = [{ duration_years: totalYears }];
            } else {
                // Senão, somar ao existente
                const existing = (profileData.experience || []).reduce((sum, exp) => sum + (exp.duration_years || 0), 0);
                profileData.experience[0].duration_years = existing + totalYears; // Simplificação
            }
            return profileData;
        }

        // Função para calcular aderência (adaptada para extrair dados corretamente)
        function calculateAdherence(profileData, jobDesc) {
            // CORREÇÕES: Pré-processar profileData
            const processedData = inferDegree(profileData);
            const dataWithExp = calculateExperienceFromProjects(processedData);
            const dataWithSkills = { ...dataWithExp, skills: extractSkills(dataWithExp) };

            let score = 0.0;
            const reasons = [];

            // 1. Escolaridade (25%)
            const requiredEdu = jobDesc.escolaridade.toLowerCase();
            const profileEdu = (dataWithSkills.education || []).map(edu => (edu.degree || '').toLowerCase()).filter(Boolean);
            const eduMatch = profileEdu.some(edu => edu.includes(requiredEdu) || requiredEdu.includes(edu));
            if (eduMatch) {
                score += 25;
                reasons.push(`Escolaridade compatível: ${requiredEdu} encontrado.`);
            } else {
                reasons.push(`Escolaridade parcial: requer ${requiredEdu}, mas perfil tem ${profileEdu.length > 0 ? profileEdu.slice(0,2).join(', ') : 'nenhuma informação clara'}.`);
            }

            // Skills (usando extraídas)
            const profileSkills = (dataWithSkills.skills || []).map(s => (s.name || '').toLowerCase());

            // 2. Obrigatórios (30%)
            const requiredSkills = jobDesc.conhecimentos_obrigatorios.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
            const matches = requiredSkills.filter(req => profileSkills.some(skill => skill.includes(req) || req.includes(skill))).length;
            const skillScore = requiredSkills.length ? (matches / requiredSkills.length) * 30 : 0;
            score += skillScore;
            reasons.push(matches === requiredSkills.length ? "Todos os conhecimentos obrigatórios atendidos." : `${matches}/${requiredSkills.length} conhecimentos obrigatórios atendidos (ex: ${requiredSkills.slice(0,2).join(', ')}).`);

            // 3. Desejados (20%)
            const desiredSkills = jobDesc.conhecimentos_desejados.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
            const matchesDesired = desiredSkills.filter(des => profileSkills.some(skill => skill.includes(des) || des.includes(skill))).length;
            const desiredScore = desiredSkills.length ? (matchesDesired / desiredSkills.length) * 20 : 0;
            score += desiredScore;
            if (matchesDesired > 0) reasons.push(`${matchesDesired}/${desiredSkills.length} conhecimentos desejados atendidos (ex: ${desiredSkills.slice(0,2).join(', ')}).`);

            // 4. Experiência (20%)
            const requiredExpYears = parseFloat(jobDesc.tempo_experiencia) || 0;
            const totalExpYears = (dataWithSkills.experience || []).reduce((sum, exp) => sum + (exp.duration_years || 0), 0);
            const expMatch = requiredExpYears > 0 ? Math.min((totalExpYears / requiredExpYears) * 20, 20) : 20;
            score += expMatch;
            reasons.push(`Experiência: ${totalExpYears.toFixed(1)} anos totais (requer ${requiredExpYears}).`);

            // 5. Observações (5%)
            const otherKeywords = jobDesc.outras_observacoes.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
            const profileText = JSON.stringify(dataWithSkills).toLowerCase();
            const otherMatches = otherKeywords.filter(kw => profileText.includes(kw)).length;
            const otherScore = otherKeywords.length ? (otherMatches / otherKeywords.length) * 5 : 0;
            score += otherScore;
            if (otherMatches > 0) reasons.push(`${otherMatches}/${otherKeywords.length} observações atendidas (ex: ${otherKeywords.slice(0,2).join(', ')}).`);

            return { score: Math.round(score * 10) / 10, reason: reasons.join(' | ') };
        }

        // Event Listeners (com retry e logs)
        document.getElementById('loadCsv').addEventListener('click', () => {
            const fileInput = document.getElementById('csvFile');
            const file = fileInput.files[0];
            if (!file) {
                alert('Selecione um arquivo CSV!');
                return;
            }

            Papa.parse(file, {
                header: true,
                complete: (results) => {
                    candidates = results.data.filter(row => row.slug); // Filtra linhas válidas
                    alert(`Dataset carregado: ${candidates.length} candidatos.`);
                    document.getElementById('analyzeBtn').disabled = false;
                },
                error: (err) => alert(`Erro ao carregar CSV: ${err}`)
            });
        });

        document.getElementById('analyzeBtn').addEventListener('click', async () => {
            if (candidates.length === 0) {
                alert('Carregue o dataset primeiro!');
                return;
            }

            const jobForm = document.getElementById('jobForm');
            const jobDesc = {
                escolaridade: jobForm.escolaridade.value,
                conhecimentos_obrigatorios: jobForm.conhecimentos_obrigatorios.value,
                conhecimentos_desejados: jobForm.conhecimentos_desejados.value,
                tempo_experiencia: jobForm.tempo_experiencia.value,
                outras_observacoes: jobForm.outras_observacoes.value
            };

            results = [];
            const progressSection = document.getElementById('progress');
            const progressFill = document.getElementById('progressFill');
            const progressText = document.getElementById('progressText');
            progressSection.style.display = 'block';
            document.getElementById('analyzeBtn').disabled = true;

            for (let i = 0; i < candidates.length; i++) {
                const row = candidates[i];
                const slug = row.slug;
                const name = row.name || slug;
                progressText.textContent = `Processando: ${name} (${i + 1}/${candidates.length})`;
                progressFill.style.width = `${((i + 1) / candidates.length) * 100}%`;

                let profileData = null;
                let attempts = 0;
                while (attempts < 2 && !profileData) {  // Retry 2x
                    profileData = await extractProfileData(slug);
                    attempts++;
                    if (!profileData && attempts < 2) {
                        console.log(`🔄 Retry ${attempts} para ${slug}`);
                        await new Promise(resolve => setTimeout(resolve, 5000)); // Espera extra
                    }
                }

                if (profileData) {
                    const { score, reason } = calculateAdherence(profileData, jobDesc);
                    results.push({ name, slug, score, reason, profileData });
                    console.log(`${name}: Score ${score}% - Skills extraídas:`, extractSkills(profileData).slice(0,5));
                } else {
                    results.push({ name, slug, score: 0, reason: "Falha na extração de dados do perfil (ver console para detalhes).", profileData: null });
                    console.error(`${name}: Falha total`);
                }

                await new Promise(resolve => setTimeout(resolve, 3000)); // Rate limit conservador
            }

            progressSection.style.display = 'none';
            document.getElementById('analyzeBtn').disabled = false;

            // Ordenar por score descendente
            results.sort((a, b) => b.score - a.score);

            // Mostrar top 5
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

            // Debug: Top JSON
            if (results[0]?.profileData) {
                document.getElementById('debugJson').textContent = JSON.stringify(results[0].profileData, null, 2);
                document.getElementById('debug').style.display = 'block';
            }

            // Download
            const csvContent = [
                ['name', 'slug', 'score', 'reason'],
                ...results.map(r => [r.name, r.slug, r.score, `"${r.reason.replace(/"/g, '""')}"`])
            ].map(row => row.join(',')).join('\n');
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