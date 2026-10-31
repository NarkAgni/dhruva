/*
* Dhruva GNOME Extension
* Copyright (C) 2026 NarkAgni
*
* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* any later version.
*
* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with this program. If not, see <https://www.gnu.org/licenses/>.
*/


const OPERATOR_ALIASES = { '×': '*', '÷': '/', '−': '-', ',': '.' };
const TOKEN_PATTERN = /\s*(\d+\.?\d*|\.\d+|[-+*/%^()])/y;
const MAX_PRECISION = 12;


function tokenize(text) {
    const source = text.replace(/[×÷−,]/g, char => OPERATOR_ALIASES[char]).trim();
    const tokens = [];
    TOKEN_PATTERN.lastIndex = 0;
    while (TOKEN_PATTERN.lastIndex < source.length) {
        const match = TOKEN_PATTERN.exec(source);
        if (!match) return null;
        tokens.push(match[1]);
    }
    return tokens;
}


class Parser {
    constructor(tokens) {
        this._tokens = tokens;
        this._index = 0;
    }

    get isDone() {
        return this._index === this._tokens.length;
    }

    _peek() {
        return this._tokens[this._index];
    }

    _take(token) {
        if (this._peek() !== token) return false;
        this._index++;
        return true;
    }

    expression() {
        let value = this._term();
        for (;;) {
            if (this._take('+')) value += this._term();
            else if (this._take('-')) value -= this._term();
            else return value;
        }
    }

    _term() {
        let value = this._unary();
        for (;;) {
            if (this._take('*')) value *= this._unary();
            else if (this._take('/')) value /= this._unary();
            else if (this._take('%')) value %= this._unary();
            else return value;
        }
    }

    _unary() {
        if (this._take('-')) return -this._unary();
        if (this._take('+')) return this._unary();
        return this._power();
    }

    _power() {
        const base = this._primary();
        return this._take('^') ? base ** this._unary() : base;
    }

    _primary() {
        if (this._take('(')) {
            const value = this.expression();
            if (!this._take(')')) throw new Error('Missing )');
            return value;
        }
        const token = this._peek();
        if (token === undefined || !/^[\d.]/.test(token)) throw new Error('Expected number');
        this._index++;
        return parseFloat(token);
    }
}


export function evaluate(text) {
    const tokens = tokenize(text.startsWith('=') ? text.slice(1) : text);
    if (!tokens || tokens.length < 2 || !tokens.slice(1).some(token => /^[-+*/%^]$/.test(token))) return null;

    try {
        const parser = new Parser(tokens);
        const value = parser.expression();
        if (!parser.isDone || !Number.isFinite(value)) return null;
        return Number.isInteger(value) ? `${value}` : `${parseFloat(value.toPrecision(MAX_PRECISION))}`;
    } catch (_e) {
        return null;
    }
}