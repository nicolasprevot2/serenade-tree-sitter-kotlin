/*
 * MIT License
 *
 * Copyright (c) 2019 fwcd
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// Using an adapted version of https://kotlinlang.org/docs/reference/grammar.html

const PREC = {
  POSTFIX: 16,
  PREFIX: 15,
  TYPE_RHS: 14,
  AS: 13,
  MULTIPLICATIVE: 12,
  ADDITIVE: 11,
  RANGE: 10,
  INFIX: 9,
  ELVIS: 8,
  CHECK: 7,
  COMPARISON: 6,
  EQUALITY: 5,
  CONJUNCTION: 4,
  DISJUNCTION: 3,
  SPREAD: 2,
  SIMPLE_USER_TYPE: 2,
  VAR_DECL: 1,
  ASSIGNMENT: 1,
  BLOCK: 1,
  LAMBDA_LITERAL: 0,
  RETURN_OR_THROW: 0,
  COMMENT: 0,
}
const DEC_DIGITS = token(sep1(/[0-9]+/, /_+/))
const HEX_DIGITS = token(sep1(/[0-9a-fA-F]+/, /_+/))
const BIN_DIGITS = token(sep1(/[01]/, /_+/))
const REAL_EXPONENT = token(seq(/[eE]/, optional(/[+-]/), DEC_DIGITS))

module.exports = grammar({
  name: 'kotlin',

  conflicts: $ => [
    // Ambiguous when used in an explicit delegation expression,
    // since the '{' could either be interpreted as the class body
    // or as the anonymous function body. Consider the following sequence:
    //
    // 'class'  simple_identifier  ':'  user_type  'by'  'fun'  '('  ')'  •  '{'  …
    //
    // Possible interpretations:
    //
    // 'class'  simple_identifier  ':'  user_type  'by'  (anonymous_function  'fun'  '('  ')'  •  function_body)
    // 'class'  simple_identifier  ':'  user_type  'by'  (anonymous_function  'fun'  '('  ')')  •  '{'  …
    [$.anonymous_function],

    // Member access operator '::' conflicts with callable reference
    [$.primary_expression_, $.callable_reference],

    // @Type(... could either be an annotation constructor invocation or an annotated expression
    [$.constructor_invocation, $._unescaped_annotation],

    // "expect" as a plaform modifier conflicts with expect as an identifier
    [$.platform_modifier, $.simple_identifier],
    // "data", "inner" as class modifier or id
    [$.class_modifier, $.simple_identifier],

    // "<x>.<y> = z assignment conflicts with <x>.<y>() function call"
    [$._postfix_unary_expression, $.expression_],

    // ambiguity between generics and comparison operations (foo < b > c)
    [$.call, $.prefix_expression, $.comparison_expression],
    [$.call, $.range_expression, $.comparison_expression],
    [$.call, $.elvis_expression, $.comparison_expression],
    [$.call, $.check_expression, $.comparison_expression],
    [$.call, $.additive_expression, $.comparison_expression],
    [$.call, $.infix_expression, $.comparison_expression],
    [$.call, $.multiplicative_expression, $.comparison_expression],
    [$.type_arguments, $._comparison_operator],

    // ambiguity between prefix expressions and annotations before functions
    [$.statement_, $.prefix_expression],
    [$.statement_, $.prefix_expression, $.modifiers],
    [$.prefix_expression, $.when_subject],
    [$.prefix_expression, $.value_argument],

    // ambiguity between multiple user types and class property/function declarations
    [$.user_type],
    [$.user_type, $.anonymous_function],
    [$.user_type, $.function_type],

    // ambiguity between annotated_lambda with modifiers and modifiers from var declarations
    [$.annotated_lambda, $.modifiers],

    // ambiguity between simple identifier 'set/get' with actual setter/getter functions.
    [$.setter, $.simple_identifier],
    [$.getter, $.simple_identifier],

    // serenade if style inherently has conflicts
    [$.if],
    [$.if_clause, $.else_if_clause],
    [$.return],
    [$.variable_declaration],
    [$.property_assignment],
  ],

  externals: $ => [$._automatic_semicolon],

  extras: $ => [
    $.comment,
    /\s+/, // Whitespace
  ],

  word: $ => $._alpha_identifier,

  rules: {
    // ====================
    // Syntax grammar
    // ====================

    // ==========
    // General
    // ==========

    // start
    program: $ =>
      seq(
        optional($.shebang_line),
        repeat($.file_annotation),
        optional($.package_header),
        optional_with_placeholder('import_list', repeat($.import)),
        optional_with_placeholder('statement_list', repeat($.statement))
      ),

    statement: $ => seq($.statement_, $._semi),

    shebang_line: $ => seq('#!', /[^\r\n]*/),

    file_annotation: $ =>
      seq(
        '@',
        'file',
        ':',
        choice(
          seq('[', repeat1($._unescaped_annotation), ']'),
          $._unescaped_annotation
        ),
        $._semi
      ),

    package_header: $ => seq('package', $.identifier, $._semi),

    import: $ =>
      seq(
        'import',
        $.identifier,
        optional(choice(seq('.*'), $.import_alias)),
        $._semi
      ),

    import_alias: $ => seq('as', alias($.simple_identifier, $.type_identifier)),

    top_level_object: $ => seq($.declaration_, optional($._semis)),

    type_alias: $ =>
      seq(
        optional($.modifiers),
        'typealias',
        alias($.simple_identifier, $.type_identifier),
        '=',
        $._type
      ),

    declaration_: $ =>
      choice(
        $.class_declaration,
        $.object_declaration,
        $.function,
        $.property,
        // TODO: it would be better to have getter/setter only in
        // property but it's difficult to get ASI
        // (Automatic Semicolon Insertion) working in the lexer for
        // getter/setter. Indeed, they can also have modifiers in
        // front, which means it's not enough to lookahead for 'get' or 'set' in
        // the lexer, you also need to handle modifier keywords. It is thus
        // simpler to accept them here.
        $.getter,
        $.setter,
        $.type_alias
      ),

    // ==========
    // Classes
    // ==========

    class_declaration: $ =>
      prec.right(
        choice(
          seq(
            optional($.modifiers),
            choice('class', 'interface'),
            alias($.simple_identifier, $.identifier),
            optional($.type_parameters),
            optional($.primary_constructor),
            optional_with_placeholder(
              'implements_list_optional',
              seq(':', alias($.delegation_specifiers_, $.implements_list))
            ),
            optional($.type_constraints),
            optional($.class_body)
          ),
          seq(
            optional($.modifiers),
            'enum',
            'class',
            alias($.simple_identifier, $.identifier),
            optional($.type_parameters),
            optional($.primary_constructor),
            optional_with_placeholder(
              'implements_list_optional',
              seq(':', alias($.delegation_specifiers_, $.implements_list))
            ),
            optional($.type_constraints),
            optional($.enum_class_body)
          )
        )
      ),

    primary_constructor: $ =>
      seq(
        optional(seq(optional($.modifiers), 'constructor')),
        $._class_parameters
      ),

    class_body: $ =>
      seq(
        '{',
        optional_with_placeholder(
          'class_member_list',
          $.class_member_declarations_
        ),
        '}'
      ),

    _class_parameters: $ =>
      seq('(', optional(sep1($.class_parameter, ',')), optional(','), ')'),

    class_parameter: $ =>
      seq(
        optional($.modifiers),
        optional(choice('val', 'var')),
        $.simple_identifier,
        ':',
        $._type,
        optional(seq('=', $.expression_))
      ),

    delegation_specifiers_: $ =>
      prec.left(
        sep1(
          alias($.delegation_specifier, $.implements_type),
          // $._annotated_delegation_specifier, // TODO: Annotations cause ambiguities with type modifiers
          ','
        )
      ),

    delegation_specifier: $ =>
      prec.left(
        choice(
          $.constructor_invocation,
          $.explicit_delegation,
          $.user_type,
          $.function_type
        )
      ),

    constructor_invocation: $ => seq($.user_type, $.value_arguments),

    _annotated_delegation_specifier: $ =>
      seq(repeat($.annotation), $.delegation_specifier),

    explicit_delegation: $ =>
      seq(choice($.user_type, $.function_type), 'by', $.expression_),

    type_parameters: $ => seq('<', sep1($.type_parameter, ','), '>'),

    type_parameter: $ =>
      seq(
        optional($.type_parameter_modifiers),
        alias($.simple_identifier, $.type_identifier),
        optional(seq(':', $._type))
      ),

    type_constraints: $ =>
      prec.right(seq('where', sep1($.type_constraint, ','))),

    type_constraint: $ =>
      seq(
        repeat($.annotation),
        alias($.simple_identifier, $.type_identifier),
        ':',
        $._type
      ),

    // ==========
    // Class members
    // ==========

    class_member_declarations_: $ =>
      repeat1(seq(alias($._class_member_declaration, $.member), $._semis)),

    _class_member_declaration: $ =>
      choice(
        $.declaration_,
        $.companion_object,
        $.anonymous_initializer,
        $.secondary_constructor
      ),

    anonymous_initializer: $ => seq('init', $.enclosed_body),

    companion_object: $ =>
      seq(
        optional($.modifiers),
        'companion',
        'object',
        optional(alias($.simple_identifier, $.type_identifier)),
        optional(seq(':', $.delegation_specifiers_)),
        optional($.class_body)
      ),

    function_value_parameters_: $ =>
      seq(
        '(',
        optional_with_placeholder(
          'parameter_list',
          seq(
            optional(
              sep1(alias($.function_value_parameter_, $.parameter), ',')
            ),
            optional(',')
          )
        ),
        ')'
      ),

    function_value_parameter_: $ =>
      seq(
        optional($.parameter_modifiers),
        $.parameter_,
        optional(seq('=', $.expression_))
      ),

    receiver_type_: $ =>
      seq(
        optional($.type_modifiers),
        choice($.type_reference_, $.parenthesized_type, $.nullable_type)
      ),

    function: $ =>
      prec.right(
        seq(
          // TODO
          optional($.modifiers),
          'fun',
          optional($.type_parameters),
          optional(seq($.receiver_type_, optional('.'))),
          field('identifier', $.simple_identifier),
          $.function_value_parameters_,
          optional_with_placeholder(
            'type_optional',
            seq(':', alias($._type, $.type))
          ),
          optional($.type_constraints),
          optional($.function_body)
        )
      ),

    function_body: $ => choice($.enclosed_body, seq('=', $.expression_)),

    single_variable_declaration: $ =>
      prec.left(
        PREC.VAR_DECL,
        seq(
          // repeat($.annotation), TODO
          field('identifier', $.simple_identifier),
          optional_with_placeholder(
            'type_optional',
            seq(':', alias($._type, $.type))
          )
        )
      ),

    variable_declaration: $ => alias($.property_assignment, $.assignment),

    property_assignment: $ =>
      seq(
        choice(
          alias($.single_variable_declaration, $.assignment_variable),
          $.multi_variable_declaration
        ),
        optional($.type_constraints),
        optional_with_placeholder(
          'assignment_value_list_optional',
          alias($.property_assignment_value, $.assignment_value)
        )
      ),

    property_assignment_value: $ =>
      choice(seq('=', $.expression_), $.property_delegate),

    property: $ =>
      prec.right(
        seq(
          optional($.modifiers),
          choice('val', 'var'),
          optional($.type_parameters),
          optional(seq($.receiver_type_, optional('.'))),
          $.variable_declaration,
          optional(';'),
          choice(
            // TODO: Getter-setter combinations
            optional($.getter),
            optional($.setter)
          )
        )
      ),

    property_delegate: $ => seq('by', $.expression_),

    getter: $ =>
      prec.right(
        seq(
          optional($.modifiers),
          'get',
          optional(seq('(', ')', optional(seq(':', $._type)), $.function_body))
        )
      ),

    setter: $ =>
      prec.right(
        seq(
          optional($.modifiers),
          'set',
          optional(
            seq(
              '(',
              $.parameter_with_optional_type,
              ')',
              optional(seq(':', $._type)),
              $.function_body
            )
          )
        )
      ),

    parameters_with_optional_type: $ =>
      seq('(', sep1($.parameter_with_optional_type, ','), ')'),

    parameter_with_optional_type: $ =>
      seq(
        optional($.parameter_modifiers),
        $.simple_identifier,
        optional(seq(':', $._type))
      ),

    parameter_: $ =>
      seq(
        field('identifier', $.simple_identifier),
        field('type_optional', seq(':', alias($._type, $.type)))
      ),

    object_declaration: $ =>
      prec.right(
        seq(
          optional($.modifiers),
          'object',
          alias($.simple_identifier, $.type_identifier),
          optional(seq(':', $.delegation_specifiers_)),
          optional($.class_body)
        )
      ),

    secondary_constructor: $ =>
      seq(
        optional($.modifiers),
        'constructor',
        $.function_value_parameters_,
        optional(seq(':', $.constructor_delegation_call)),
        optional($.enclosed_body)
      ),

    constructor_delegation_call: $ =>
      seq(choice('this', 'super'), $.value_arguments),

    // ==========
    // Enum classes
    // ==========

    enum_class_body: $ =>
      seq(
        '{',
        optional_with_placeholder(
          'enum_member_list',
          seq(
            optional($._enum_entries),
            optional(seq(';', optional($.class_member_declarations_)))
          )
        ),
        '}'
      ),

    _enum_entries: $ => seq(sep1($.enum_entry, ','), optional(',')),

    enum_entry: $ =>
      seq(
        optional($.modifiers),
        $.simple_identifier,
        optional($.value_arguments),
        optional($.class_body)
      ),

    // ==========
    // Types
    // ==========

    _type: $ =>
      seq(
        optional($.type_modifiers),
        choice(
          $.parenthesized_type,
          $.nullable_type,
          $.type_reference_,
          $.function_type
        )
      ),

    type_reference_: $ => choice($.user_type, 'dynamic'),

    nullable_type: $ =>
      seq(choice($.type_reference_, $.parenthesized_type), repeat1($._quest)),

    _quest: $ => '?',

    // TODO: Figure out a better solution than right associativity
    //       to prevent nested types from being recognized as
    //       unary expresions with navigation suffixes.

    user_type: $ => sep1($._simple_user_type, '.'),

    _simple_user_type: $ =>
      prec.right(
        PREC.SIMPLE_USER_TYPE,
        seq(
          alias($.simple_identifier, $.type_identifier),
          optional($.type_arguments)
        )
      ),

    type_projection: $ =>
      choice(seq(optional($.type_projection_modifiers), $._type), '*'),

    type_projection_modifiers: $ => repeat1($._type_projection_modifier),

    _type_projection_modifier: $ => $.variance_modifier,

    function_type: $ =>
      seq(
        optional(seq($._simple_user_type, '.')), // TODO: Support "real" types
        $.function_type_parameters,
        '->',
        $._type
      ),

    // A higher-than-default precedence resolves the ambiguity with 'parenthesized_type'
    function_type_parameters: $ =>
      prec.left(
        1,
        seq('(', optional(sep1(choice($.parameter_, $._type), ',')), ')')
      ),

    parenthesized_type: $ => seq('(', $._type, ')'),

    parenthesized_user_type: $ =>
      seq('(', choice($.user_type, $.parenthesized_user_type), ')'),

    // ==========
    // Statements
    // ==========

    statements: $ =>
      seq(
        $.statement_,
        repeat(seq($._semis, $.statement_)),
        optional($._semis)
      ),

    statement_: $ =>
      field(
        'statement',
        choice(
          $.declaration_,
          seq(
            repeat(choice($.label, $.annotation)),
            choice($.assignment, $.loop_statement_, $.expression_)
          )
        )
      ),

    label: $ => token(seq(/[a-zA-Z_][a-zA-Z_0-9]*/, '@')),

    control_structure_body: $ =>
      choice($.enclosed_body, alias($.statement_, $.statement)),

    enclosed_body: $ =>
      prec(
        PREC.BLOCK,
        seq('{', optional_with_placeholder('statement_list', $.statements), '}')
      ),

    loop_statement_: $ => choice($.for, $.while, $.do_while_statement),

    for: $ => $.for_each_clause,

    for_each_clause: $ =>
      prec.right(
        seq(
          'for',
          '(',
          field(
            'block_iterator',
            seq(
              repeat($.annotation),
              choice(
                $.single_variable_declaration,
                $.multi_variable_declaration
              )
            )
          ),
          field('for_each_separator', 'in'),
          field('block_collection', $.expression_),
          ')',
          optional($.control_structure_body)
        )
      ),

    while: $ => $.while_clause,

    while_clause: $ =>
      seq(
        'while',
        '(',
        alias($.expression_, $.condition),
        ')',
        choice(';', $.control_structure_body)
      ),

    do_while_statement: $ =>
      prec.right(
        seq(
          'do',
          optional($.control_structure_body),
          'while',
          '(',
          $.expression_,
          ')'
        )
      ),

    // See also https://github.com/tree-sitter/tree-sitter/issues/160
    // generic EOF/newline token
    _semi: $ => choice($._automatic_semicolon, ';'),

    _semis: $ => choice($._automatic_semicolon, ';'),

    assignment: $ =>
      choice(
        prec.left(
          PREC.ASSIGNMENT,
          seq(
            $.directly_assignable_expression,
            $._assignment_and_operator,
            $.assignment_value
          )
        ),
        prec.left(
          PREC.ASSIGNMENT,
          seq($.directly_assignable_expression, '=', $.assignment_value)
        )
        // TODO
      ),

    assignment_value: $ => $.expression_,

    // ==========
    // Expressions
    // ==========

    expression_: $ =>
      choice($.primary_expression_, $._unary_expression, $._binary_expression),

    // Unary expressions

    _unary_expression: $ =>
      choice(
        $.postfix_expression,
        $.call,
        $.indexing_expression,
        $.navigation_expression,
        $.prefix_expression,
        $.as_expression,
        $.spread_expression
      ),

    postfix_expression: $ =>
      prec.left(PREC.POSTFIX, seq($.expression_, $._postfix_unary_operator)),

    call: $ => prec.left(PREC.POSTFIX, seq($.expression_, $.call_suffix)),

    indexing_expression: $ =>
      prec.left(PREC.POSTFIX, seq($.expression_, $.indexing_suffix)),

    navigation_expression: $ =>
      prec.left(PREC.POSTFIX, seq($.expression_, $.navigation_suffix)),

    prefix_expression: $ =>
      prec.right(
        seq(
          choice($.annotation, $.label, $._prefix_unary_operator),
          $.expression_
        )
      ),

    as_expression: $ =>
      prec.left(PREC.AS, seq($.expression_, $._as_operator, $._type)),

    spread_expression: $ => prec.left(PREC.SPREAD, seq('*', $.expression_)),

    // Binary expressions

    _binary_expression: $ =>
      choice(
        $.multiplicative_expression,
        $.additive_expression,
        $.range_expression,
        $.infix_expression,
        $.elvis_expression,
        $.check_expression,
        $.comparison_expression,
        $.equality_expression,
        $.comparison_expression,
        $.equality_expression,
        $.conjunction_expression,
        $.disjunction_expression
      ),

    multiplicative_expression: $ =>
      prec.left(
        PREC.MULTIPLICATIVE,
        seq($.expression_, $._multiplicative_operator, $.expression_)
      ),

    additive_expression: $ =>
      prec.left(
        PREC.ADDITIVE,
        seq($.expression_, $._additive_operator, $.expression_)
      ),

    range_expression: $ =>
      prec.left(PREC.RANGE, seq($.expression_, '..', $.expression_)),

    infix_expression: $ =>
      prec.left(
        PREC.INFIX,
        seq($.expression_, $.simple_identifier, $.expression_)
      ),

    elvis_expression: $ =>
      prec.left(PREC.ELVIS, seq($.expression_, '?:', $.expression_)),

    check_expression: $ =>
      prec.left(
        PREC.CHECK,
        seq(
          $.expression_,
          choice(
            seq($._in_operator, $.expression_),
            seq($._is_operator, $._type)
          )
        )
      ),

    comparison_expression: $ =>
      prec.left(
        PREC.COMPARISON,
        seq($.expression_, $._comparison_operator, $.expression_)
      ),

    equality_expression: $ =>
      prec.left(
        PREC.EQUALITY,
        seq($.expression_, $._equality_operator, $.expression_)
      ),

    conjunction_expression: $ =>
      prec.left(PREC.CONJUNCTION, seq($.expression_, '&&', $.expression_)),

    disjunction_expression: $ =>
      prec.left(PREC.DISJUNCTION, seq($.expression_, '||', $.expression_)),

    // Suffixes

    indexing_suffix: $ => seq('[', sep1($.expression_, ','), ']'),

    navigation_suffix: $ =>
      seq(
        $._member_access_operator,
        choice($.simple_identifier, $.parenthesized_expression, 'class')
      ),

    call_suffix: $ =>
      prec.left(
        seq(
          // this introduces ambiguities with 'less than' for comparisons
          optional($.type_arguments),
          choice(
            seq(optional($.value_arguments), $.annotated_lambda),
            $.value_arguments
          )
        )
      ),

    annotated_lambda: $ =>
      seq(repeat($.annotation), optional($.label), $.lambda_literal),

    type_arguments: $ => seq('<', sep1($.type_projection, ','), '>'),

    value_arguments: $ =>
      seq(
        '(',
        optional_with_placeholder(
          'argument_list',
          sep1(alias($.value_argument, $.argument), ',')
        ),
        ')'
      ),

    value_argument: $ =>
      seq(
        optional($.annotation),
        optional(seq(field('identifier', $.simple_identifier), '=')),
        optional('*'),
        $.expression_
      ),

    primary_expression_: $ =>
      choice(
        $.parenthesized_expression,
        $.simple_identifier,
        $._literal_constant,
        $.string_literal,
        $.callable_reference,
        $._function_literal,
        $.object_literal,
        $.collection_literal,
        $.this_expression,
        $.super_expression,
        $.if,
        $.when_expression,
        $.try,
        $.jump_expression
      ),

    parenthesized_expression: $ => seq('(', $.expression_, ')'),

    collection_literal: $ =>
      seq('[', $.expression_, repeat(seq(',', $.expression_)), ']'),

    _literal_constant: $ =>
      choice(
        $.boolean_literal,
        $.integer_literal,
        $.hex_literal,
        $.bin_literal,
        $.character_literal,
        $.real_literal,
        'null',
        $.long_literal,
        $.unsigned_literal
      ),

    string_literal: $ =>
      choice($.line_string_literal, $.multi_line_string_literal),

    line_string_literal: $ =>
      seq('"', repeat(choice($.line_string_content_, $.interpolation_)), '"'),

    multi_line_string_literal: $ =>
      seq(
        '"""',
        repeat(choice($._multi_line_string_content, $.interpolation_)),
        '"""'
      ),

    line_string_content_: $ =>
      choice($._line_str_text, $._line_str_escaped_char),

    line_string_expression: $ => seq('${', $.expression_, '}'),

    _multi_line_string_content: $ => choice($._multi_line_str_text, '"'),

    interpolation_: $ =>
      choice(
        seq('${', alias($.expression_, $.interpolated_expression), '}'),
        seq('$', alias($.simple_identifier, $.interpolated_identifier))
      ),

    lambda_literal: $ =>
      prec(
        PREC.LAMBDA_LITERAL,
        seq(
          '{',
          optional(seq(optional($.lambda_parameters), '->')),
          optional($.statements),
          '}'
        )
      ),

    multi_variable_declaration: $ =>
      seq(
        '(',
        field(
          'assignment_variable_list',
          sep1(alias($.single_variable_declaration, $.assignment_variable), ',')
        ),
        ')'
      ),

    lambda_parameters: $ => sep1($._lambda_parameter, ','),

    _lambda_parameter: $ =>
      choice($.single_variable_declaration, $.multi_variable_declaration),

    anonymous_function: $ =>
      seq(
        'fun',
        optional(seq(sep1($._simple_user_type, '.'), '.')), // TODO
        '(',
        ')',
        optional($.function_body)
      ),

    _function_literal: $ => choice($.lambda_literal, $.anonymous_function),

    object_literal: $ =>
      seq('object', optional(seq(':', $.delegation_specifiers_)), $.class_body),

    this_expression: $ => 'this',

    super_expression: $ =>
      seq(
        'super'
        // TODO optional(seq("<", $._type, ">")),
        // TODO optional(seq("@", $.simple_identifier))
      ),

    if: $ =>
      seq(
        $.if_clause,
        optional_with_placeholder(
          'else_if_clause_list',
          repeat($.else_if_clause)
        ),
        optional_with_placeholder('else_clause_optional', $.else_clause)
      ),

    if_clause: $ =>
      seq(
        'if',
        '(',
        field('condition', $.expression_),
        ')',
        choice($.control_structure_body, ';')
      ),

    else_if_clause: $ =>
      prec.dynamic(
        1,
        seq(
          'else',
          'if',
          '(',
          field('condition', $.expression_),
          ')',
          choice($.control_structure_body, ';')
        )
      ),

    else_clause: $ => seq('else', choice($.control_structure_body, ';')),

    when_subject: $ =>
      seq(
        '(',
        optional(
          seq(repeat($.annotation), 'val', $.single_variable_declaration, '=')
        ),
        $.expression_,
        ')'
      ),

    when_expression: $ =>
      seq('when', optional($.when_subject), '{', repeat($.when_entry), '}'),

    when_entry: $ =>
      seq(
        choice(
          seq($.when_condition, repeat(seq(',', $.when_condition))),
          'else'
        ),
        '->',
        $.control_structure_body,
        optional($._semi)
      ),

    when_condition: $ => choice($.expression_, $.range_test, $.type_test),

    range_test: $ => seq($._in_operator, $.expression_),

    type_test: $ => seq($._is_operator, $._type),

    try: $ =>
      seq(
        $.try_clause,
        optional_with_placeholder('catch_list', repeat1($.catch)),
        optional_with_placeholder('finally_clause_optional', $.finally_clause)
      ),

    try_clause: $ => seq('try', $.enclosed_body),

    catch: $ =>
      seq(
        'catch',
        '(',
        repeat($.annotation),
        $.simple_identifier,
        ':',
        $._type,
        ')',
        $.enclosed_body
      ),

    finally_clause: $ => seq('finally', $.enclosed_body),

    jump_expression: $ =>
      choice(
        prec.right(PREC.RETURN_OR_THROW, $.throw),
        prec.right(PREC.RETURN_OR_THROW, $.return),
        'continue',
        $._continue_at,
        'break',
        $._break_at
      ),

    throw: $ => seq('throw', $.expression_),
    return: $ =>
      seq(
        choice('return', $._return_at),
        optional_with_placeholder(
          'return_value_optional',
          alias($.expression_, $.return_value)
        )
      ),

    callable_reference: $ =>
      seq(
        optional(alias($.simple_identifier, $.type_identifier)), // TODO
        '::',
        choice($.simple_identifier, 'class')
      ),

    _assignment_and_operator: $ => choice('+=', '-=', '*=', '/=', '%='),

    _equality_operator: $ => choice('!=', '!==', '==', '==='),

    _comparison_operator: $ => choice('<', '>', '<=', '>='),

    _in_operator: $ => choice('in', '!in'),

    _is_operator: $ => choice('is', $._not_is),

    _additive_operator: $ => choice('+', '-'),

    _multiplicative_operator: $ => choice('*', '/', '%'),

    _as_operator: $ => choice('as', 'as?'),

    _prefix_unary_operator: $ => choice('++', '--', '-', '+', '!'),

    _postfix_unary_operator: $ => choice('++', '--', '!!'),

    _member_access_operator: $ => choice('.', $._safe_nav, '::'),

    _safe_nav: $ => '?.', // TODO: '?' and '.' should actually be separate tokens
    //       but produce an LR(1) conflict that way, however.
    //       ('as' expression with '?' produces conflict). Also
    //       does it seem to be very uncommon to write the safe
    //       navigation operator 'split up' in Kotlin.

    _indexing_suffix: $ =>
      seq(
        '[',
        $.expression_,
        repeat(seq(',', $.expression_)),
        optional(','),
        ']'
      ),

    postfix_unary_suffix_: $ =>
      choice($._postfix_unary_operator, $.navigation_suffix, $.indexing_suffix),

    _postfix_unary_expression: $ =>
      seq($.primary_expression_, repeat($.postfix_unary_suffix_)),

    directly_assignable_expression: $ =>
      prec(
        PREC.ASSIGNMENT,
        field(
          'assignment_variable',
          choice(
            $._postfix_unary_expression,
            $.simple_identifier
            // TODO
          )
        )
      ),

    // ==========
    // Modifiers
    // ==========

    modifiers: $ => prec.left(repeat1(choice($.annotation, $._modifier))),

    parameter_modifiers: $ =>
      repeat1(choice($.annotation, $.parameter_modifier)),

    _modifier: $ =>
      choice(
        $.class_modifier,
        $.member_modifier,
        $.visibility_modifier,
        $.function_modifier,
        $.property_modifier,
        $.inheritance_modifier,
        $.parameter_modifier,
        $.platform_modifier
      ),

    type_modifiers: $ => repeat1($._type_modifier),

    _type_modifier: $ => choice($.annotation, 'suspend'),

    class_modifier: $ => choice('sealed', 'annotation', 'data', 'inner'),

    member_modifier: $ => choice('override', 'lateinit'),

    visibility_modifier: $ =>
      choice('public', 'private', 'internal', 'protected'),

    variance_modifier: $ => choice('in', 'out'),

    type_parameter_modifiers: $ => repeat1($._type_parameter_modifier),

    _type_parameter_modifier: $ =>
      choice($.reification_modifier, $.variance_modifier, $.annotation),

    function_modifier: $ =>
      choice('tailrec', 'operator', 'infix', 'inline', 'external', 'suspend'),

    property_modifier: $ => 'const',

    inheritance_modifier: $ => choice('abstract', 'final', 'open'),

    parameter_modifier: $ => choice('vararg', 'noinline', 'crossinline'),

    reification_modifier: $ => 'reified',

    platform_modifier: $ => choice('expect', 'actual'),

    // ==========
    // Annotations
    // ==========

    annotation: $ => choice($._single_annotation, $._multi_annotation),

    _single_annotation: $ =>
      seq('@', optional($.use_site_target), $._unescaped_annotation),

    _multi_annotation: $ =>
      seq(
        '@',
        optional($.use_site_target),
        '[',
        repeat1($._unescaped_annotation),
        ']'
      ),

    use_site_target: $ =>
      seq(
        choice(
          'field',
          'property',
          'get',
          'set',
          'receiver',
          'param',
          'setparam',
          'delegate'
        ),
        ':'
      ),

    _unescaped_annotation: $ => choice($.constructor_invocation, $.user_type),

    // ==========
    // Identifiers
    // ==========

    simple_identifier: $ =>
      choice(
        $.lexical_identifier_,
        'expect',
        'data',
        'inner',
        'actual',
        'set',
        'get'
        // TODO: More soft keywords
      ),

    identifier: $ => sep1($.simple_identifier, '.'),

    // ====================
    // Lexical grammar
    // ====================

    // ==========
    // General
    // ==========

    // Source: https://github.com/tree-sitter/tree-sitter-java/blob/bc7124d924723e933b6ffeb5f22c4cf5248416b7/grammar.js#L1030
    comment: $ =>
      token(
        prec(
          PREC.COMMENT,
          choice(seq('//', /.*/), seq('/*', /[^*]*\*+([^/*][^*]*\*+)*/, '/'))
        )
      ),

    // ==========
    // Separators and operations
    // ==========

    // ==========
    // Keywords
    // ==========

    _return_at: $ => seq('return@', $.lexical_identifier_),

    _continue_at: $ => seq('continue@', $.lexical_identifier_),

    _break_at: $ => seq('break@', $.lexical_identifier_),

    _this_at: $ => seq('this@', $.lexical_identifier_),

    _super_at: $ => seq('super@', $.lexical_identifier_),

    _not_is: $ => '!is',

    _not_in: $ => '!in',

    // ==========
    // Literals
    // ==========

    real_literal: $ =>
      token(
        choice(
          seq(
            choice(
              seq(DEC_DIGITS, REAL_EXPONENT),
              seq(
                optional(DEC_DIGITS),
                '.',
                DEC_DIGITS,
                optional(REAL_EXPONENT)
              )
            ),
            optional(/[fF]/)
          ),
          seq(DEC_DIGITS, /[fF]/)
        )
      ),

    integer_literal: $ => token(seq(optional(/[1-9]/), DEC_DIGITS)),

    hex_literal: $ => token(seq('0', /[xX]/, HEX_DIGITS)),

    bin_literal: $ => token(seq('0', /[bB]/, BIN_DIGITS)),

    unsigned_literal: $ =>
      seq(
        choice($.integer_literal, $.hex_literal, $.bin_literal),
        /[uU]/,
        optional('L')
      ),

    long_literal: $ =>
      seq(choice($.integer_literal, $.hex_literal, $.bin_literal), 'L'),

    boolean_literal: $ => choice('true', 'false'),

    character_literal: $ => seq("'", choice($.escape_seq_, /[^\n\r'\\]/), "'"),

    // ==========
    // Identifiers
    // ==========

    lexical_identifier_: $ =>
      choice($._alpha_identifier, $._backtick_identifier),

    _alpha_identifier: $ => /[a-zA-Z_][a-zA-Z_0-9]*/,

    _backtick_identifier: $ => /`[^\r\n`]+`/,

    _uni_character_literal: $ => seq('\\u', /[0-9a-fA-F]{4}/),

    _escaped_identifier: $ => /\\[tbrn'"\\$]/,

    escape_seq_: $ => choice($._uni_character_literal, $._escaped_identifier),

    // ==========
    // Strings
    // ==========

    _line_str_text: $ => /[^\\"$]+/,

    _line_str_escaped_char: $ =>
      choice($._escaped_identifier, $._uni_character_literal),

    _multi_line_str_text: $ => /[^"$]+/,
  },
})

function sep1(rule, separator) {
  return seq(rule, repeat(seq(separator, rule)))
}

function optional_with_placeholder(field_name, rule) {
  return choice(field(field_name, rule), field(field_name, blank()))
}
