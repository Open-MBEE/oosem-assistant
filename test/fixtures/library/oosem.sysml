// A stand-in for the OOSEM method library, written for these tests. It declares only what the
// core reads: the root package, the three concepts with their collections, and the semantic
// metadata behind the #blackbox, #graybox and #whitebox keywords.
library package RecursiveDecompositionPattern {
    library package Concepts {
        abstract occurrence def Blackbox;
        abstract occurrence def Graybox :> Blackbox;
        abstract occurrence def Whitebox :> Graybox;
        abstract occurrence blackboxes : Blackbox[*] nonunique;
        abstract occurrence grayboxes : Graybox[*] nonunique;
        abstract occurrence whiteboxes : Whitebox[*] nonunique;
    }

    library package Metadata {
        private import Concepts::*;
        private import Metaobjects::SemanticMetadata;

        metadata def <blackbox> BlackboxMetadata :> SemanticMetadata { :>> baseType = blackboxes meta SysML::Usage; }
        metadata def <graybox> GrayboxMetadata :> SemanticMetadata { :>> baseType = grayboxes meta SysML::Usage; }
        metadata def <whitebox> WhiteboxMetadata :> SemanticMetadata { :>> baseType = whiteboxes meta SysML::Usage; }
    }
}
