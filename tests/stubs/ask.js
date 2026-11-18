// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The question dialog, for the tests: each question is noted in `asked` and answered with the next of `answers` (null, as if
// closed, when there are none left).

/** The questions asked (their titles), and the answers to give, in order. */
export const questions = { asked: [], answers: [] };

/** Answers a question with the next answer in `questions.answers`. */
export function ask({ title }) {
    questions.asked.push(title);
    return Promise.resolve(questions.answers.length ? questions.answers.shift() : null);
}
