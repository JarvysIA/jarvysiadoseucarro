import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/privacidade")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade — Jarvys" },
      { name: "description", content: "Política de Privacidade do Jarvys, em conformidade com a LGPD." },
    ],
  }),
  component: PrivacidadePage,
});

function PrivacidadePage() {
  return (
    <div className="relative min-h-screen bg-background px-6 pt-10 pb-16 text-foreground">
      <Link to="/welcome" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>

      <h1 className="mt-6 text-2xl font-bold tracking-tight">Política de Privacidade — Jarvys</h1>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-muted-foreground">
        <Section title="1. Quem somos">
          <p>
            O Jarvys (&quot;nós&quot;, &quot;nosso&quot;, &quot;Jarvys&quot; ou &quot;Plataforma&quot;) é um
            serviço de gestão inteligente de manutenção veicular, doravante denominado Controlador dos
            dados pessoais tratados nesta Política, contatável pelo e-mail contato@jarvys.com.br.
          </p>
          <p>
            Esta Política de Privacidade descreve como coletamos, usamos, armazenamos, compartilhamos e
            protegemos os dados pessoais dos usuários do Jarvys, em conformidade com a Lei Geral de
            Proteção de Dados (LGPD — Lei nº 13.709/2018).
          </p>
        </Section>

        <Section title="2. Quais dados coletamos">
          <h3 className="text-sm font-semibold text-foreground">2.1 Dados fornecidos diretamente por você</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>Nome completo, e-mail e senha (cadastro).</li>
            <li>CPF, quando exigido para determinadas transações de pagamento.</li>
            <li>Número de telefone/WhatsApp, quando você vincula sua conta ao nosso assistente conversacional.</li>
            <li>Placa do veículo — a partir dela, consultamos bases públicas (FIPE) para obter automaticamente marca, modelo, ano e cor.</li>
            <li>Dados de manutenção que você registra: quilometragem, descrição e valor de despesas, categoria do serviço, fotos de notas fiscais.</li>
            <li>Mensagens de texto, áudio (transcrito) e imagens que você envia pelo WhatsApp para registrar despesas, tirar dúvidas ou atualizar informações do veículo.</li>
            <li>Código de indicação, se você participa do nosso programa de indicação (&quot;padrinho&quot;), e dados bancários/PIX necessários para eventual saque de comissão.</li>
          </ul>

          <h3 className="mt-4 text-sm font-semibold text-foreground">2.2 Dados gerados automaticamente pela Plataforma</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>Imagem ilustrativa do seu veículo, gerada por inteligência artificial a partir de marca/modelo/ano/cor (para exibição no seu painel).</li>
            <li>Perfil técnico do veículo (tipo de combustível, câmbio, direção, sistema de sincronismo), inferido por IA a partir dos dados públicos do modelo, usado para calcular o cronograma de manutenção.</li>
            <li>Cronograma de revisão e alertas de manutenção, calculados a partir da quilometragem informada.</li>
            <li>Registros de interação com o assistente via WhatsApp (data/hora da última mensagem, status de verificação do número).</li>
          </ul>

          <h3 className="mt-4 text-sm font-semibold text-foreground">2.3 Dados de pagamento</h3>
          <p>
            Processamos pagamentos por meio de parceiro especializado (Asaas). Não armazenamos dados
            completos de cartão ou chave PIX em nossos servidores — essas informações são tratadas
            diretamente pelo processador de pagamento, sujeito à política de privacidade própria dele.
          </p>
        </Section>

        <Section title="3. Para que usamos seus dados (finalidades)">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border text-foreground">
                  <th className="py-2 pr-3 font-semibold">Finalidade</th>
                  <th className="py-2 font-semibold">Base legal (LGPD)</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Criar e gerenciar sua conta", "Execução de contrato (art. 7º, V)"],
                  ["Gerar o cronograma de manutenção do seu veículo", "Execução de contrato"],
                  ["Responder mensagens enviadas via WhatsApp (texto, áudio, foto)", "Execução de contrato / consentimento (vinculação do número)"],
                  ["Processar pagamentos de ativação/assinatura", "Execução de contrato"],
                  ["Gerar imagem ilustrativa do veículo via IA", "Legítimo interesse (melhoria da experiência)"],
                  ["Enviar alertas proativos de manutenção e mensagens de reengajamento pelo WhatsApp", "Consentimento (você pode desativar a qualquer momento)"],
                  ["Processar programa de indicação e pagamento de comissões", "Execução de contrato"],
                  ["Prevenir fraude e cumprir obrigações legais/fiscais", "Cumprimento de obrigação legal (art. 7º, II)"],
                  ["Melhorar o produto e treinar modelos internos de forma agregada/anonimizada", "Legítimo interesse"],
                ].map(([finalidade, base]) => (
                  <tr key={finalidade} className="border-b border-border/60 align-top">
                    <td className="py-2 pr-3">{finalidade}</td>
                    <td className="py-2">{base}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="4. Com quem compartilhamos seus dados">
          <p>
            Não vendemos seus dados pessoais. Compartilhamos dados, na medida estritamente necessária, com:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Provedores de infraestrutura e banco de dados (Supabase), que armazenam seus dados de forma segura.</li>
            <li>
              Provedores de inteligência artificial (incluindo, entre outros, OpenAI e o gateway de IA
              da Lovable), para processar mensagens de texto, transcrever áudio, interpretar fotos de
              notas fiscais e gerar imagens ilustrativas de veículos. Esses provedores podem estar
              localizados fora do Brasil — o envio de dados para eles constitui transferência
              internacional de dados, feita com base em cláusulas contratuais e salvaguardas adequadas,
              conforme art. 33 da LGPD.
            </li>
            <li>Provedor de mensageria WhatsApp (Z-API), para envio e recebimento de mensagens.</li>
            <li>Processador de pagamentos (Asaas), para cobrança e emissão de PIX.</li>
            <li>Consulta de tabela FIPE e dados de placa (APIs de terceiros), para preencher automaticamente dados do seu veículo.</li>
            <li>Autoridades públicas, quando exigido por lei, ordem judicial ou requisição de autoridade competente.</li>
          </ul>
          <p>
            Não compartilhamos seus dados com parceiros de afiliados (ex: Mercado Livre) — os links de
            produtos exibidos são gerados de forma genérica (marca/modelo/item), sem envio de nenhum
            dado pessoal seu ao parceiro no momento da geração do link.
          </p>
        </Section>

        <Section title="5. Por quanto tempo guardamos seus dados">
          <p>
            Mantemos seus dados enquanto sua conta estiver ativa e pelo prazo necessário para cumprir
            obrigações legais (fiscais, contratuais) após o encerramento, ou até que você solicite a
            exclusão, o que for mais longo. Dados de mensagens do WhatsApp vinculadas ao histórico de
            despesas são mantidos como parte do seu histórico de manutenção, salvo solicitação de exclusão.
          </p>
        </Section>

        <Section title="6. Seus direitos como titular de dados">
          <p>Nos termos do art. 18 da LGPD, você pode, a qualquer momento, solicitar:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Confirmação da existência de tratamento de dados;</li>
            <li>Acesso aos seus dados;</li>
            <li>Correção de dados incompletos, inexatos ou desatualizados;</li>
            <li>Anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade com a lei;</li>
            <li>Portabilidade dos dados a outro fornecedor;</li>
            <li>Eliminação dos dados pessoais tratados com base no seu consentimento;</li>
            <li>Revogação do consentimento (ex: desvincular seu WhatsApp, parar de receber alertas proativos);</li>
            <li>Informação sobre entidades com as quais compartilhamos seus dados.</li>
          </ul>
          <p>
            Para exercer qualquer um desses direitos, entre em contato pelo e-mail contato@jarvys.com.br.
            Responderemos em prazo razoável, conforme exigido pela LGPD.
          </p>
        </Section>

        <Section title="7. Segurança da informação">
          <p>
            Adotamos medidas técnicas e organizacionais para proteger seus dados, incluindo controle de
            acesso por linha (Row Level Security) em nosso banco de dados, criptografia em trânsito,
            segregação de permissões por função, e monitoramento de vulnerabilidades. Nenhum sistema é
            100% imune a incidentes — em caso de incidente de segurança que possa acarretar risco a
            você, notificaremos conforme exigido pela LGPD e pela ANPD.
          </p>
        </Section>

        <Section title="8. Crianças e adolescentes">
          <p>
            O Jarvys não é direcionado a menores de 18 anos e não coletamos intencionalmente dados de
            menores. Se você acredita que uma criança nos forneceu dados pessoais, entre em contato
            para que possamos excluí-los.
          </p>
        </Section>

        <Section title="9. Cookies e tecnologias similares">
          <p>
            Não utilizamos cookies de rastreamento além do estritamente necessário para funcionamento e
            autenticação da Plataforma.
          </p>
        </Section>

        <Section title="10. Alterações nesta Política">
          <p>
            Podemos atualizar esta Política periodicamente. Mudanças significativas serão comunicadas
            por e-mail ou aviso no aplicativo, com antecedência razoável.
          </p>
        </Section>

        <Section title="11. Encarregado de Dados (DPO) e contato">
          <p>
            Para dúvidas, solicitações ou reclamações relacionadas a esta Política ou ao tratamento dos
            seus dados pessoais, entre em contato pelo e-mail contato@jarvys.com.br.
          </p>
          <p>
            Você também pode registrar reclamação junto à Autoridade Nacional de Proteção de Dados
            (ANPD) — www.gov.br/anpd.
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}
