import QRCode from "qrcode";

// QR Code renderizado como SVG inline, no servidor.
//
// SVG e não PNG base64 de propósito: a etiqueta vai para impressora térmica
// (203/300 dpi) e um bitmap gerado em pixels de tela sai serrilhado no módulo
// do QR, que é justamente o que o leitor precisa ler nítido. O SVG imprime na
// resolução nativa da impressora.
//
// `margin: 0` porque a quiet zone é dada pelo padding do container na etiqueta
// (mais fácil de controlar em mm do que em módulos), e `errorCorrectionLevel:
// "M"` (15%) porque a etiqueta vai colada em palete: aguenta sujeira e raspão
// sem inflar o QR como o nível "H" faria.
export async function renderQrSvg(value: string, sizeMm: number) {
  const svg = await QRCode.toString(value, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 0
  });

  // A lib devolve o SVG só com `viewBox`, sem width/height — sem os atributos
  // ele estica para 100% do container e o QR sai do tamanho errado. Injetamos
  // a medida em mm para o QR escalar com a etiqueta na impressão, não com a
  // tela. O replace remove atributos existentes antes, para o dia em que a lib
  // passar a emiti-los.
  return svg.replace(/<svg([^>]*)>/, (_match, attrs: string) => {
    const cleaned = attrs.replace(/\s(?:width|height)="[^"]*"/g, "");
    return `<svg${cleaned} width="${sizeMm}mm" height="${sizeMm}mm">`;
  });
}
