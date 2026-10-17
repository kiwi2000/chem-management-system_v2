// GHS 判定のルール言語（S27）。Langium の文法。
// 予約語は英語、名前と文言は自由。ブロックは { }。1 文は改行で終わる（改行は区切りとして読む）。
grammar GhsRules

entry Ruleset:
    NL* 'ruleset' name=STRING 'version' version=NUMBER
    ('extends' baseName=STRING 'version' baseVersion=NUMBER)?
    '{' NL* (sections+=Section NL*)* '}' NL*;

Section:
    MetaBlock | ClassesBlock | OptionsBlock | RulesBlock | LabelsBlock | SdsBlock | TestsBlock
    | ExcludeStmt | AdoptStmt | ChooseStmt | FlagStmt | DefaultsStmt | RuleDef;

// ---------- meta ----------
MetaBlock: 'meta' '{' NL* (entries+=MetaEntry NL*)* '}';
MetaEntry: key=('title' | 'revision' | 'valid_from' | 'valid_to' | 'note') value=(STRING | DATE);

// ---------- classes（国連のレイヤーで宣言） ----------
ClassesBlock: 'classes' '{' NL* (classes+=ClassDecl NL*)* '}';
ClassDecl:
    'class' name=ClassName label=STRING 'categories' '[' categories+=Category (',' categories+=Category)* ']'
    ('unit' unit=UNIT)?
    (NL* 'subcategories' parent=Category '->' '[' subs+=Category (',' subs+=Category)* ']')?;

// ---------- options（選択点の宣言） ----------
OptionsBlock: 'options' '{' NL* (options+=OptionDecl NL*)* '}';
OptionDecl:
    'option' name=ClassName label=STRING 'values' '[' values+=OptionValue (',' values+=OptionValue)* ']'
    ('safest' safest=OptionValue)? (NL* 'source' source=STRING)?;
OptionValue: name=OptionName ('(' arg=NumberLit ')')?;
OptionName returns string: ID | 'adopt' | 'exclude' | 'sds' | 'manual' | 'labels';

// ---------- 差分（国・自社のレイヤー） ----------
ExcludeStmt: 'exclude' target=ClassPattern ('as' result=ResultKind)?;
AdoptStmt: 'adopt' target=ClassPattern;
ChooseStmt: 'choose' option=ClassName '=' value=OptionValue (lock=('locked' | 'open'))?;
FlagStmt: 'flag' flag=ID 'for' 'ingredients' 'where' cond=Expr;
DefaultsStmt: {infer DefaultsStmt} 'defaults' 'safest';

// ---------- rules ----------
RulesBlock: 'rules' '{' NL* (rules+=RuleDef NL*)* '}';
RuleDef: 'rule' class=ClassName (mode=('override' | 'add'))? body=Block;

Block: '{' NL* (stmts+=Stmt NL*)* '}';

Stmt:
    RelevantStmt | IgnoreStmt | NonAdditiveStmt | BandsStmt | ConvertStmt
    | TypedBlock | IfStmt | AssignStmt
    | ClassifyStmt | ClassifyByBandsStmt | NotClassifiedStmt | UnclassifiableStmt
    | NeedsJudgementStmt | NoteStmt | Block;

RelevantStmt: 'consider' 'ingredients' 'where' cond=Expr;
IgnoreStmt: 'ignore' 'ingredients' 'where' cond=Expr;
NonAdditiveStmt: 'nonadditive' 'ingredients' 'where' cond=Expr;
BandsStmt: 'bands' '{' NL* bands+=Band (',' NL* bands+=Band)* NL* '}';
Band: category=Category ':' cond=Expr;
ConvertStmt: 'conversion' target=ID '{' NL* entries+=ConvertEntry (',' NL* entries+=ConvertEntry)* NL* '}';
ConvertEntry: category=Category ':' value=NumberLit;
// 計算の型を名指しする枠。中身は普通の文（型の名前は検査と読みやすさのため）
TypedBlock: kind=('precondition' | 'additivity' | 'weighted_sum' | 'threshold' | 'range' | 'manual') body=Block;
IfStmt: 'if' cond=Expr 'then' NL* then=Stmt (NL* 'else' NL* else=Stmt)?;
AssignStmt: name=ID '=' value=Expr;
ClassifyStmt: 'classify' class=ClassName 'as' category=Expr ('because' because=STRING)?;
ClassifyByBandsStmt: 'classify' 'by' 'bands' '(' value=Expr ')';
NotClassifiedStmt: {infer NotClassifiedStmt} 'not_classified';
UnclassifiableStmt: {infer UnclassifiableStmt} 'unclassifiable';
NeedsJudgementStmt: 'needs_judgement' reason=STRING;
NoteStmt: 'note' text=STRING ('place' place=Expr)?;

// ---------- labels / sds（最小版。あとで広げる） ----------
LabelsBlock: 'labels' '{' NL* (entries+=LabelEntry NL*)* '}';
LabelEntry: HPrecedence | SignalWordPrecedence | OptionDecl | PStatementRule | OmitRule | PictogramPrecedence;
HPrecedence: 'h_precedence' '{' NL* (pairs+=SuppressPair (';' NL* pairs+=SuppressPair)* ';'? NL*)? '}';
SuppressPair: winner=ID 'suppresses' loser=ID;
SignalWordPrecedence: 'signal_word_precedence' '{' NL* winner=ID 'over' loser=ID NL* '}';
PictogramPrecedence: 'pictogram_precedence' '{' NL* (items+=PictogramSuppress (';' NL* items+=PictogramSuppress)* ';'? NL*)? '}';
PictogramSuppress: winner=ID ('(' qualifier=ID ')')? 'suppresses' loser=ID ('for' '[' for+=ClassPattern (',' for+=ClassPattern)* ']')?;
PStatementRule: 'p_statement' code=ID 'choose' '[' choices+=STRING (',' choices+=STRING)* ']' ('when' cond=Expr)?;
OmitRule: 'omit' code=ID ('when' cond=Expr)? ('note' note=STRING)?;

SdsBlock: 'sds' '{' NL* (entries+=SdsEntry NL*)* '}';
SdsEntry: ListBelowLimit | SectionFrom;
ListBelowLimit: 'list_ingredients_below_limit' '{' NL* (items+=BelowLimitItem (';' NL* items+=BelowLimitItem)* ';'? NL*)? '}';
BelowLimitItem: target=ClassPattern 'from' from=NumberLit;
SectionFrom: 'section' section=NUMBER 'from' 'regulations' '[' laws+=ID (',' laws+=ID)* ']';

// ---------- tests ----------
TestsBlock: 'tests' '{' NL* (tests+=TestCase NL*)* '}';
TestCase: 'test' name=STRING '{' NL* mixture=MixtureSpec NL* (props=ProductSpec NL*)? expect=ExpectSpec NL* '}';
MixtureSpec: 'mixture' '{' NL* (items+=IngredientSpec ((';' | NL+) items+=IngredientSpec)* (';')? NL*)? '}';
IngredientSpec: name=STRING conc=NumberLit (facts+=IngredientFact)*;
IngredientFact:
    {infer UnknownFact} 'unknown' ('(' class=ClassName ')')?
    | {infer FlagFact} 'flag' flag=ID
    | {infer KeyFact} key=ClassName ('=' value=NumberLit | category=Category);
ProductSpec: 'props' '{' NL* (props+=ProductProp ((';' | NL+) props+=ProductProp)* (';')? NL*)? '}';
ProductProp: key=ID value=(NumberLit | STRING | ID);
ExpectSpec: 'expect' '{' NL* (items+=ExpectItem ((',' | ';' | NL+) items+=ExpectItem)* NL*)? '}';
ExpectItem: class=ClassName result=(Category | ResultKind);

// ---------- 式 ----------
Expr: WhereExpr;
// 集合に条件を付ける（ingredients where …、名前の付いた集合 where …）
WhereExpr infers Expr: OrExpr ({infer WhereExpr.set=current} 'where' cond=OrExpr)?;
OrExpr infers Expr: AndExpr ({infer BinaryExpr.left=current} op='or' right=AndExpr)*;
AndExpr infers Expr: NotExpr ({infer BinaryExpr.left=current} op='and' right=NotExpr)*;
NotExpr infers Expr: {infer UnaryExpr} op='not' operand=NotExpr | Comparison;
Comparison infers Expr:
    Additive (
        {infer BinaryExpr.left=current} op=('==' | '!=' | '<' | '<=' | '>' | '>=' | 'in') right=Additive
        | {infer BetweenExpr.value=current} 'between' low=Additive 'and' high=Additive
    )?;
Additive infers Expr: Multiplicative ({infer BinaryExpr.left=current} op=('+' | '-') right=Multiplicative)*;
Multiplicative infers Expr: Unary ({infer BinaryExpr.left=current} op=('*' | '/') right=Unary)*;
Unary infers Expr: {infer UnaryExpr} op='-' operand=Unary | Primary;
Primary infers Expr:
    '(' Expr ')'
    | {infer IfExpr} 'if' cond=Expr 'then' then=Expr 'else' else=Expr
    | {infer ListExpr} '[' (items+=Expr (',' items+=Expr)*)? ']'
    | {infer AggregateExpr} fn=('sum' | 'count' | 'any' | 'max' | 'min') '(' first=Expr ('of' set=Expr)? ')'
    | {infer SetExpr} kind=('ingredients' | 'all_ingredients')
    | {infer CallExpr} fn=(ID | 'option' | 'category' | 'unknown' | 'convert') '(' (args+=Expr (',' args+=Expr)*)? ')'
    | {infer NumberLit} value=NUMBER (unit=UNIT)?
    | {infer RefExpr} ref=ClassName
    | {infer StringLit} value=STRING
    | {infer BoolLit} value=('true' | 'false');

NumberLit: value=NUMBER (unit=UNIT)?;

// 名前: 区切り付き（acute.oral、product.prop、ate.oral）。数字で始まる部分も許す（skin.2）
ClassName returns string: NAMEPART ('.' NAMEPART)*;
ClassPattern returns string: NAMEPART ('.' (NAMEPART | '*'))*;
NAMEPART returns string: ID | NUMBER | CATEGORY | 'adopt' | 'exclude' | 'sds' | 'manual';
Category returns string: NUMBER | CATEGORY | ID;
ResultKind returns string: 'not_classified' | 'unclassifiable';

hidden terminal WS: /[ \t\r]+/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
terminal NL: /\n+/;
terminal DATE: /[0-9]{4}-[0-9]{2}-[0-9]{2}/;
terminal UNIT: /%|mg\/kg|mg\/L|g\/L|ppmV|mm2\/s|°C|℃|kPa|Pa|g\/mol|kJ\/g/;
terminal CATEGORY: /[0-9]+[A-Z]+/;
terminal NUMBER returns number: /[0-9]+(\.[0-9]+)?/;
terminal ID: /[_a-zA-Z][\w]*/;  // 名前は半角英数（日本語は文字列で書く）。\p{L} だと予約語の長い語（oral の or）が崩れた
terminal STRING: /"(\\.|[^"\\])*"/;
