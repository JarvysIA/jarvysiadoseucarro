import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/termos")({
  head: () => ({
    meta: [
      { title: "Termos de Uso — Jarvys" },
      { name: "description", content: "Termos de Uso do Jarvys." },
    ],
  }),
  component: TermosPage,
});

function TermosPage() {
  return (
    <div className="relative min-h-screen bg-background px-6 pt-10 pb-16 text-foreground">
      <Link to="/welcome" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>

      <h1 className="mt-6 text-2xl font-bold tracking-tight">Termos de Uso — Jarvys</h1>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-muted-foreground">
        <Section title="1. Aceitação dos Termos">
          <p>
            Ao criar uma conta ou usar o Jarvys (&quot;Plataforma&quot;, &quot;nós&quot;), você concorda
            com estes Termos de Uso e com nossa Política de Privacidade. Se você não concordar, não
            utilize a Plataforma.
          </p>
        </Section>

        <Section title="2. O que é o Jarvys">
          <p>
            O Jarvys é uma plataforma de gestão inteligente de manutenção veicular, que permite:
            cadastrar veículos por placa, acompanhar quilometragem e cronograma de revisão, registrar
            despesas de manutenção (manualmente, por foto de nota fiscal, ou por mensagem de WhatsApp),
            consultar valores FIPE, e receber recomendações de itens de manutenção com links de compra.
          </p>
        </Section>

        <Section title="3. Cadastro e conta">
          <ul className="list-disc space-y-1 pl-5">
            <li>Você deve fornecer informações verdadeiras, completas e atualizadas no cadastro.</li>
            <li>Você é responsável por manter a confidencialidade da sua senha e por todas as atividades realizadas na sua conta.</li>
            <li>Você deve ter no mínimo 18 anos para criar uma conta no Jarvys.</li>
            <li>Reservamo-nos o direito de suspender ou encerrar contas que violem estes Termos, contenham informações falsas, ou apresentem uso fraudulento.</li>
          </ul>
        </Section>

        <Section title="4. Planos, ativação e pagamento">
          <ul className="list-disc space-y-1 pl-5">
            <li>O cadastro do app é gratuito. A ativação completa de cada veículo (liberando o cronograma de manutenção e funcionalidades associadas) pode exigir pagamento único, conforme condições vigentes no momento da contratação.</li>
            <li>Pagamentos são processados via PIX, através de parceiro de pagamento (Asaas). Os valores, formas de cobrança e eventuais planos de assinatura (ex: Premium) vigentes estão descritos na Plataforma no momento da contratação.</li>
            <li>Cupons de desconto e cortesias, quando disponíveis, seguem regras próprias divulgadas no momento da oferta.</li>
            <li>Não há reembolso automático após a ativação, salvo exigência legal ou disposição específica no momento da compra.</li>
          </ul>
        </Section>

        <Section title="5. Uso do assistente via WhatsApp">
          <ul className="list-disc space-y-1 pl-5">
            <li>A vinculação do seu número de WhatsApp ao Jarvys é opcional e depende do seu consentimento explícito, com verificação do número.</li>
            <li>Ao vincular seu WhatsApp, você concorda em receber mensagens do assistente relacionadas a: confirmações de despesa, atualizações de quilometragem, respostas a dúvidas técnicas, alertas proativos de manutenção próxima, e mensagens ocasionais de reengajamento caso fique inativo.</li>
            <li>Você pode solicitar a qualquer momento o descadastramento (opt-out) das mensagens, respondendo com o comando indicado pelo assistente ou entrando em contato pelo suporte. Após o opt-out, você deixa de receber novas mensagens automáticas.</li>
            <li>Fotos, áudios e textos enviados pelo WhatsApp para registrar despesas são processados por inteligência artificial para extrair informações (ex: valor, categoria, data). Você é responsável por conferir se a informação extraída está correta antes de confirmar o lançamento.</li>
          </ul>
        </Section>

        <Section title="6. Conteúdo gerado por Inteligência Artificial">
          <ul className="list-disc space-y-1 pl-5">
            <li>Imagens de veículos exibidas no seu painel são geradas por IA a partir de marca/modelo/ano/cor e têm caráter meramente ilustrativo — podem não corresponder exatamente à aparência real do seu veículo.</li>
            <li>
              Recomendações de manutenção, cronogramas e respostas do assistente (&quot;Dr. Jarvys&quot;)
              são geradas com apoio de inteligência artificial e não substituem a avaliação de um
              profissional mecânico qualificado. O Jarvys não se responsabiliza por decisões de
              manutenção tomadas exclusivamente com base nas recomendações da Plataforma.
            </li>
            <li>A extração automática de dados de notas fiscais e áudios está sujeita a erros de interpretação da IA. Revise sempre antes de confirmar.</li>
          </ul>
        </Section>

        <Section title="7. Links de afiliados e parceiros comerciais">
          <ul className="list-disc space-y-1 pl-5">
            <li>O Jarvys pode exibir links de compra de produtos e serviços (ex: peças, óleo, seguros) através de parceiros comerciais, incluindo programas de afiliados (ex: Mercado Livre).</li>
            <li>Podemos receber comissão por compras realizadas através desses links, sem custo adicional para você.</li>
            <li>Não nos responsabilizamos pela qualidade, entrega, ou veracidade dos anúncios de terceiros — confirme sempre a compatibilidade do produto com seu veículo e prefira lojas oficiais antes de comprar.</li>
          </ul>
        </Section>

        <Section title="8. Programa de indicação (&quot;padrinho&quot;)">
          <ul className="list-disc space-y-1 pl-5">
            <li>Usuários podem indicar o Jarvys para terceiros através de um código de indicação pessoal.</li>
            <li>Comissões e condições do programa de indicação são divulgadas na área específica da Plataforma e podem ser alteradas mediante aviso prévio.</li>
            <li>Saques de comissão acumulada seguem regras próprias de valor mínimo e prazo, descritas na área &quot;Carteira&quot; do app.</li>
            <li>Reservamo-nos o direito de invalidar indicações fraudulentas ou obtidas em desacordo com estes Termos.</li>
          </ul>
        </Section>

        <Section title="9. Propriedade intelectual">
          <p>
            Todo o conteúdo, marca, layout, código e tecnologia do Jarvys são de propriedade exclusiva
            do Controlador ou licenciados a ele, sendo vedada a reprodução, engenharia reversa ou uso
            não autorizado.
          </p>
        </Section>

        <Section title="10. Limitação de responsabilidade">
          <p>
            Na máxima extensão permitida pela lei aplicável, o Jarvys não se responsabiliza por: danos
            indiretos decorrentes do uso da Plataforma; imprecisões em dados de terceiros (FIPE,
            consulta de placa); indisponibilidade temporária por manutenção ou falha de terceiros
            (WhatsApp, provedores de IA, processador de pagamento); decisões tomadas exclusivamente com
            base em recomendações automatizadas.
          </p>
        </Section>

        <Section title="11. Rescisão">
          <p>
            Você pode encerrar sua conta a qualquer momento. Podemos suspender ou encerrar o acesso de
            contas que violem estes Termos, mediante aviso quando possível.
          </p>
        </Section>

        <Section title="12. Alterações nestes Termos">
          <p>
            Podemos atualizar estes Termos periodicamente. Mudanças relevantes serão comunicadas com
            antecedência razoável. O uso continuado da Plataforma após a atualização implica
            concordância com os novos Termos.
          </p>
        </Section>

        <Section title="13. Legislação aplicável e foro">
          <p>
            Estes Termos são regidos pelas leis brasileiras. Fica eleito o foro da comarca do Rio de
            Janeiro/RJ para dirimir quaisquer controvérsias, com renúncia a qualquer outro, por mais
            privilegiado que seja.
          </p>
        </Section>

        <Section title="14. Contato">
          <p>Dúvidas sobre estes Termos: contato@jarvys.com.br.</p>
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
