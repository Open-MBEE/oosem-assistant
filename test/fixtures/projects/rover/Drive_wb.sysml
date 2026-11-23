package Drive_wb {
    private import RecursiveDecompositionPattern::Metadata::*;
    private import Drive_gb::*;

    #whitebox part def Drive_wb :> Drive_gb {
        #graybox part :>> motor : Motor_gb;
    }
}
