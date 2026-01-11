import { parsers as babelParsers } from "prettier/plugins/babel";
import { printers as estreePrinters } from "prettier/plugins/estree";
import { parse } from './parser.js';
import * as myImportedPrinter from './printer.js';

export const languages = [
  {
    name: 'RoundJS',
    extensions: ['.round'],
    parsers: ['round'],
  }
];

export const parsers = {
  round: {
    parse,
    astFormat: 'estree',
    locStart: (node) => node.start,
    locEnd: (node) => node.end
  }
};

export const printers = {
  estree: {
    ...estreePrinters.estree,
    print: myImportedPrinter.print
  }
};
