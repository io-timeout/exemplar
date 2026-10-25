/** Documents that cover each kind of node and the escaping they need. */
export const DOCUMENTS: Readonly<Record<string, string>> = {
  elements: '<r><a/><b x="1" y="2">t</b><c></c></r>',
  namespaces:
    '<p:r xmlns:p="urn:p" xmlns="urn:d"><c p:a="1" b="2"><p:d xmlns:p="urn:q"/></c><e xmlns=""><f/></e></p:r>',
  'escaped text': '<r a="&lt;&amp;&quot;&apos;&#9;&#10;&#13;&gt;">&lt;&amp;&gt;]]&gt;&#13;\'"</r>',
  'CDATA, comments and processing instructions':
    '<?a x?><!-- c --><r><![CDATA[<x>&amp;]]><!--in--><?pi data?></r><!--after--><?z?>',
  'a document type': '<!DOCTYPE r PUBLIC "-//P//EN" "r.dtd" [<!ENTITY e "x"><!ATTLIST r d CDATA "dv">]><r>&e;</r>',
  unicode: '<Р a\u{10000}="ok">тест \u{1F525} é</Р>',
  'xml attributes': '<r xml:lang="en" xml:space="preserve"> s </r>',
  'whitespace in element content': '<!DOCTYPE r [<!ELEMENT r (c)*>]><r>\n  <c/>\n</r>',
  'attribute names like __proto__': '<r __proto__="p" constructor="c" toString="t" length="5"/>',
};
